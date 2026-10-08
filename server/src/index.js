import 'dotenv/config';
import 'express-async-errors';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from './models/User.js';
import CareRecord from './models/CareRecord.js';
import api from './routes/api.js';
import { createVideoSignaling } from './realtime/videoSignaling.js';

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) throw new Error('MONGODB_URI and JWT_SECRET are required.');
if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
const inactivityHours = Number(process.env.INACTIVITY_THRESHOLD_HOURS || 8);
if (!Number.isFinite(inactivityHours) || inactivityHours < 1) throw new Error('INACTIVITY_THRESHOLD_HOURS must be a positive number.');

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CLIENT_ORIGIN || process.env.CLIENT_ORIGINS || 'http://localhost:5173')
  .split(',').map((origin) => origin.trim()).filter(Boolean);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
});
app.set('io', io);
app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '100kb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false }));
app.use('/api/integrations/devices', rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.use('/api', api);
app.use((error, req, res, _next) => {
  console.error('API request failed', { name: error.name, code: error.code, path: req.path });
  if (error.name === 'ValidationError' || error.name === 'CastError') return res.status(400).json({ error: 'The supplied data is invalid.' });
  if (error.code === 11000) return res.status(409).json({ error: 'That record already exists.' });
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return next(new Error('Unauthorized'));
    socket.user = user;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});
const videoSignaling = createVideoSignaling(io, User);
io.on('connection', (socket) => {
  socket.join(String(socket.user._id));
  if (socket.user.role !== 'senior') socket.user.seniorIds.forEach((id) => socket.join(String(id)));
  const touchPresence = async () => {
    try {
      await User.updateOne({ _id: socket.user._id }, { $set: { lastActivityAt: new Date() } });
      if (socket.user.role === 'senior') {
        const stale = await CareRecord.find({ kind: 'alerts', seniorId: socket.user._id, status: { $in: ['active', 'acknowledged'] }, 'data.type': 'inactivity' });
        for (const alert of stale) {
          alert.status = 'resolved';
          await alert.save();
          io.to(String(socket.user._id)).emit('care:update', { resource: 'alerts', event: 'alert:resolved', item: alert });
        }
      }
    } catch (error) {
      console.error('Could not update care-circle presence', { name: error.name, code: error.code });
    }
  };
  touchPresence();
  socket.on('presence:heartbeat', touchPresence);
  videoSignaling.attach(socket);
});

const port = Number(process.env.PORT || 4000);
try {
  await mongoose.connect(process.env.MONGODB_URI);
} catch (error) {
  console.error('MongoDB connection failed', { name: error.name, code: error.code });
  process.exitCode = 1;
  throw new Error('Could not connect to MongoDB. Check MONGODB_URI and database availability.');
}
server.listen(port, () => console.log(`CareCircle API listening on ${port}`));

setInterval(async () => {
  const cutoff = new Date(Date.now() - inactivityHours * 60 * 60 * 1000);
  try {
    const inactiveSeniors = await User.find({ role: 'senior', lastActivityAt: { $lt: cutoff } }).select('_id lastActivityAt');
    for (const senior of inactiveSeniors) {
      const existing = await CareRecord.exists({
        kind: 'alerts', seniorId: senior._id, status: { $in: ['active', 'acknowledged'] },
        'data.type': 'inactivity', createdAt: { $gte: senior.lastActivityAt },
      });
      if (existing) continue;
      const alert = await CareRecord.create({
        kind: 'alerts', seniorId: senior._id, createdBy: senior._id, status: 'active',
        data: { type: 'inactivity', severity: 'warning', message: `No CareCircle activity detected for ${inactivityHours} hours.`, source: 'inactivity monitor' },
      });
      io.to(String(senior._id)).emit('care:update', { resource: 'alerts', event: 'alert:new', item: alert });
    }
  } catch (error) {
    console.error('Could not evaluate inactivity alerts', { name: error.name, code: error.code });
  }
}, 5 * 60 * 1000);

async function issueMedicationReminders() {
  const now = new Date();
  const medications = await CareRecord.find({
    kind: 'medications', status: 'active', 'data.reminderTime': { $type: 'string' },
  }).select('seniorId createdBy data');
  for (const medication of medications) {
    const timeZone = medication.data.timeZone || 'UTC';
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const local = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (`${local.hour}:${local.minute}` !== medication.data.reminderTime) continue;
    const reminderKey = `${medication.seniorId}:${medication._id}:${local.year}-${local.month}-${local.day}`;
    try {
      const reminder = await CareRecord.create({
        kind: 'notifications', seniorId: medication.seniorId, createdBy: medication.createdBy,
        status: 'pending',
        data: {
          type: 'reminder', reminderKey, medicationId: String(medication._id),
          message: `Medication reminder: ${medication.data.name} — ${medication.data.dose}`,
        },
      });
      io.to(String(medication.seniorId)).emit('care:update', { resource: 'notifications', item: reminder });
    } catch (error) {
      if (error.code !== 11000) console.error('Could not create medication reminder', { name: error.name, code: error.code });
    }
  }
}

setInterval(() => {
  issueMedicationReminders().catch((error) => console.error('Medication reminder scheduler failed', { name: error.name, code: error.code }));
}, 30 * 1000);
