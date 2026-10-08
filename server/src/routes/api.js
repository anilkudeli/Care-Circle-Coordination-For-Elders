import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  registerInput, loginInput, forgotPasswordInput, resetPasswordInput, profileInput, changePasswordInput,
} from '../auth/schemas.js';
import { createPasswordResetToken, hashPasswordResetToken } from '../auth/passwordReset.js';
import { isEmailProviderConfigured, sendPasswordResetEmail } from '../services/email.js';
import User from '../models/User.js';
import CareRecord from '../models/CareRecord.js';
import Organization from '../models/Organization.js';
import { authenticate, allowRoles, canAccessSenior } from '../middleware/auth.js';

const router = Router();
const roles = ['senior', 'family', 'caregiver', 'admin'];
const resourceRoles = {
  alerts: roles, medications: roles, medicationEvents: roles, tasks: roles, shifts: roles,
  locations: roles, geofences: roles, checkins: roles, reports: roles,
  healthProfiles: roles, vitals: roles, appointments: roles, careNotes: roles,
  devices: ['admin', 'caregiver'], alertRules: ['admin', 'caregiver'],
  organizations: ['admin'], invoices: ['admin'], paymentEvents: ['admin'], invitations: ['admin'], notifications: roles,
  activity: roles, contacts: roles,
};
const statusTransitions = {
  alerts: { active: ['acknowledged', 'resolved'], acknowledged: ['resolved'] },
  tasks: { pending: ['in-progress', 'completed', 'cancelled'], 'in-progress': ['completed', 'cancelled'] },
  appointments: { scheduled: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'] },
  shifts: { scheduled: ['in-progress', 'cancelled'], 'in-progress': ['completed', 'cancelled'] },
  devices: { active: ['inactive', 'revoked'], inactive: ['active', 'revoked'] },
  alertRules: { active: ['inactive'], inactive: ['active'] },
  geofences: { active: ['inactive'], inactive: ['active'] },
  invoices: { pending: ['paid', 'overdue', 'cancelled'], overdue: ['paid', 'cancelled'] },
};
const validStatuses = {
  alerts: ['active', 'acknowledged', 'resolved', 'completed'],
  medications: ['active', 'paused', 'discontinued', 'completed'],
  medicationEvents: ['taken', 'missed', 'skipped'],
  tasks: ['pending', 'in-progress', 'completed', 'cancelled'],
  shifts: ['scheduled', 'in-progress', 'completed', 'cancelled'],
  checkins: ['scheduled', 'completed', 'cancelled'],
  appointments: ['scheduled', 'confirmed', 'completed', 'cancelled'],
  devices: ['active', 'inactive', 'revoked'],
  alertRules: ['active', 'inactive'],
  geofences: ['active', 'inactive'],
  invoices: ['pending', 'paid', 'overdue', 'cancelled'],
  paymentEvents: ['pending', 'requires-provider', 'failed', 'succeeded', 'refunded'],
  invitations: ['pending', 'approved', 'declined', 'cancelled'],
};
const recordInput = z.object({
  seniorId: z.string().optional(),
  status: z.string().max(40).optional(),
  occurredAt: z.coerce.date().optional(),
  data: z.record(z.unknown()).default({}),
}).strict();
const schemas = {
  alerts: z.object({ message: z.string().trim().min(3).max(500), type: z.enum(['fall', 'inactivity', 'general', 'geofence', 'emergency']), severity: z.enum(['warning', 'critical', 'info']).default('warning') }).strict(),
  medications: z.object({
    name: z.string().trim().min(1).max(120), dose: z.string().trim().min(1).max(160),
    schedule: z.string().trim().min(1).max(160), reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    timeZone: z.string().max(80).optional(), prescriber: z.string().max(120).optional(),
  }).strict().refine((data) => {
    if (!data.timeZone) return true;
    try { new Intl.DateTimeFormat('en', { timeZone: data.timeZone }); return true; } catch { return false; }
  }, { message: 'Enter a valid IANA time zone.', path: ['timeZone'] }),
  medicationEvents: z.object({
    name: z.string().trim().min(1).max(120), type: z.enum(['taken', 'missed', 'skipped']),
    notes: z.string().max(500).optional(), dose: z.string().max(160).optional(),
    medicationId: z.string().optional(),
  }).strict(),
  tasks: z.object({ title: z.string().trim().min(1).max(160), description: z.string().max(500).optional(), dueAt: z.string().optional(), priority: z.enum(['normal', 'high']).default('normal'), assignedTo: z.string().optional() }).strict(),
  shifts: z.object({ caregiver: z.string().trim().min(1).max(100), startsAt: z.string().min(1), endsAt: z.string().min(1), notes: z.string().max(500).optional() }).strict(),
  locations: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracyMeters: z.number().nonnegative().optional(), source: z.string().max(40).optional() }).strict(),
  geofences: z.object({ name: z.string().trim().min(1).max(100), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), radiusMeters: z.number().positive().max(100000) }).strict(),
  checkins: z.object({ title: z.string().trim().min(1).max(100), scheduledAt: z.string().min(1), method: z.string().max(40).optional() }).strict(),
  reports: z.object({ name: z.string().trim().min(1).max(100), notes: z.string().max(500).optional() }).strict(),
  organizations: z.object({
    name: z.string().trim().min(2).max(160), address: z.string().max(250).optional(),
    contactEmail: z.preprocess((value) => value === '' ? undefined : value, z.string().email().optional()),
    currency: z.enum(['USD', 'CAD', 'GBP', 'EUR', 'AUD']).optional(),
  }).strict(),
  invoices: z.object({
    description: z.string().trim().min(2).max(250), amount: z.number().positive(),
    dueAt: z.string().min(1), invoiceNumber: z.string().max(60).optional(),
    paymentReference: z.string().max(200).optional(), paymentMethod: z.enum(['offline']).optional(),
    lineItems: z.array(z.object({ description: z.string().min(1).max(200), quantity: z.number().positive(), unitAmount: z.number().nonnegative() }).strict()).max(50).optional(),
  }).strict(),
  invitations: z.object({ email: z.string().email(), role: z.enum(['family', 'caregiver']) }).strict(),
  notifications: z.object({ message: z.string().trim().min(1).max(500), type: z.enum(['reminder', 'update']) }).strict(),
  contacts: z.object({ name: z.string().trim().min(2).max(100), phone: z.string().trim().min(4).max(40), relationship: z.string().max(80).optional() }).strict(),
  healthProfiles: z.object({
    dateOfBirth: z.string().optional(), bloodType: z.string().max(20).optional(),
    conditions: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    allergies: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    carePreferences: z.string().max(2000).optional(), clinician: z.string().max(120).optional(),
  }).strict(),
  vitals: z.object({
    type: z.enum(['bloodPressure', 'heartRate', 'temperature', 'weight', 'bloodGlucose', 'oxygenSaturation']),
    value: z.number().finite(), unit: z.string().trim().min(1).max(20),
    systolic: z.number().positive().optional(), diastolic: z.number().positive().optional(),
    notes: z.string().max(300).optional(),
  }).strict().refine((data) => data.type !== 'bloodPressure' || data.systolic && data.diastolic, {
    message: 'Blood pressure entries require systolic and diastolic readings.',
    path: ['systolic'],
  }),
  appointments: z.object({
    title: z.string().trim().min(1).max(140), clinician: z.string().max(120).optional(),
    location: z.string().max(200).optional(), scheduledAt: z.string().min(1),
    notes: z.string().max(1000).optional(),
  }).strict(),
  careNotes: z.object({
    title: z.string().trim().min(1).max(140), body: z.string().trim().min(1).max(3000),
    visibility: z.enum(['care-team', 'family']).default('care-team'),
  }).strict(),
  devices: z.object({ name: z.string().trim().min(2).max(100), provider: z.string().max(100).optional(), deviceType: z.enum(['wearable', 'sensor', 'other']) }).strict(),
  alertRules: z.object({
    name: z.string().trim().min(2).max(100), eventType: z.enum(['fall', 'inactivity', 'heartRate', 'geofence']),
    severity: z.enum(['info', 'warning', 'critical']), thresholdMinutes: z.number().int().positive().max(1440).optional(),
  }).strict(),
  paymentEvents: z.object({ invoiceId: z.string().min(1), amount: z.number().positive(), provider: z.string().max(80), reference: z.string().max(200).optional() }).strict(),
};
function publicUser(user) {
  return {
    id: String(user._id), name: user.name, email: user.email, username: user.username || null,
    phone: user.phone || '', role: user.role,
    seniorIds: user.seniorIds.map(String), organizationId: user.organizationId ? String(user.organizationId) : null,
  };
}

function issueToken(user) {
  return jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '8h', issuer: 'carecircle' });
}

router.post('/auth/register', async (req, res) => {
  const parsed = registerInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check the registration details.', details: parsed.error.flatten() });
  const { name, email, username, phone, password, role } = parsed.data;
  if (await User.exists({ email: email.toLowerCase() })) return res.status(409).json({ error: 'An account with that email already exists.' });
  if (username && await User.exists({ username })) return res.status(409).json({ error: 'That username is already in use.' });
  const user = await User.create({ name, email, username, phone, role, passwordHash: await bcrypt.hash(password, 12) });
  res.status(201).json({ token: issueToken(user), user: publicUser(user) });
});

router.post('/auth/forgot-password', async (req, res) => {
  const parsed = forgotPasswordInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!isEmailProviderConfigured()) {
    return res.status(503).json({
      error: 'Password reset email is unavailable because the email provider is not configured.',
      code: 'email_provider_not_configured',
    });
  }

  const email = parsed.data.email.toLowerCase();
  const user = await User.findOne({ email }).select('_id email name');
  if (user) {
    const reset = createPasswordResetToken();
    await User.updateOne(
      { _id: user._id },
      { $set: { passwordResetTokenHash: reset.tokenHash, passwordResetExpiresAt: reset.expiresAt } },
    );
    try {
      await sendPasswordResetEmail({ email: user.email, name: user.name, token: reset.token });
    } catch (error) {
      console.error('Password reset email delivery failed', { name: error.name, code: error.code });
      try {
        await User.updateOne(
          { _id: user._id, passwordResetTokenHash: reset.tokenHash },
          { $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 } },
        );
      } catch (cleanupError) {
        console.error('Could not clear an undelivered password reset token', {
          name: cleanupError.name,
          code: cleanupError.code,
        });
      }
    }
  }
  res.status(202).json({
    message: 'If an account matches that email and email delivery succeeds, password reset instructions will be sent.',
  });
});

router.post('/auth/reset-password', async (req, res) => {
  const parsed = resetPasswordInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid reset token and password.' });
  const { token, password } = parsed.data;
  const user = await User.findOneAndUpdate(
    {
      passwordResetTokenHash: hashPasswordResetToken(token),
      passwordResetExpiresAt: { $gt: new Date() },
    },
    {
      $set: { passwordHash: await bcrypt.hash(password, 12) },
      $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
    },
    { new: true },
  ).select('_id');
  if (!user) return res.status(400).json({ error: 'The password reset token is invalid or expired.' });
  res.json({ message: 'Password has been reset. Please sign in.' });
});

router.post('/auth/login', async (req, res) => {
  const parsed = loginInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email or username and password.' });
  const identifier = (parsed.data.username || parsed.data.email).toLowerCase();
  const user = await User.findOne({ $or: [{ email: identifier }, { username: identifier }] }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: 'Email, username, or password is incorrect.' });
  }
  user.lastActivityAt = new Date();
  await user.save();
  res.json({ token: issueToken(user), user: publicUser(user) });
});

router.patch('/auth/profile', authenticate, async (req, res) => {
  const parsed = profileInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check the profile details.', details: parsed.error.flatten() });
  req.user.name = parsed.data.name;
  req.user.phone = parsed.data.phone;
  await req.user.save();
  res.json({ user: publicUser(req.user) });
});

router.post('/auth/change-password', authenticate, async (req, res) => {
  const parsed = changePasswordInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid current password and a strong new password.', details: parsed.error.flatten() });
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (await bcrypt.compare(parsed.data.newPassword, user.passwordHash)) {
    return res.status(400).json({ error: 'Choose a new password different from the current password.' });
  }
  user.passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  await user.save();
  res.json({ message: 'Password updated. You can continue using CareCircle with your new password.' });
});

router.get('/notification-preferences', authenticate, (req, res) => res.json({ preferences: req.user.notificationPreferences }));
router.patch('/notification-preferences', authenticate, async (req, res) => {
  const parsed = z.object({
    alerts: z.boolean().optional(), medicationReminders: z.boolean().optional(),
    careUpdates: z.boolean().optional(), invitations: z.boolean().optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data || {}).length) return res.status(400).json({ error: 'Choose at least one valid notification preference.', details: parsed.success ? undefined : parsed.error.flatten() });
  req.user.notificationPreferences = { ...req.user.notificationPreferences.toObject?.() ?? req.user.notificationPreferences, ...parsed.data };
  await req.user.save();
  res.json({ preferences: req.user.notificationPreferences });
});

router.get('/auth/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/auth/link-senior', authenticate, async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter the senior account email.' });
  if (req.user.role === 'senior') return res.status(403).json({ error: 'Senior accounts cannot link another senior.' });
  const senior = await User.findOne({ email: parsed.data.email.toLowerCase(), role: 'senior' });
  if (!senior) return res.status(404).json({ error: 'Senior account not found.' });
  if (req.user.seniorIds.some((id) => String(id) === String(senior._id))) return res.status(409).json({ error: 'You are already connected to this senior.' });
  const existing = await CareRecord.findOne({ kind: 'invitations', seniorId: senior._id, createdBy: req.user._id, status: 'pending' });
  if (existing) return res.status(409).json({ error: 'Your connection request is already awaiting approval.' });
  const invite = await CareRecord.create({
    kind: 'invitations', seniorId: senior._id, createdBy: req.user._id, status: 'pending',
    data: { requesterId: String(req.user._id), requesterName: req.user.name, requesterRole: req.user.role },
  });
  req.app.get('io').to(String(senior._id)).emit('care:update', { resource: 'invitations', item: invite });
  res.status(202).json({ message: `Connection request sent to ${senior.name}. They must approve access before you can see care information.` });
});

router.post('/integrations/devices/:id/events', receiveDeviceEvent);

router.use(authenticate);

router.get('/auth/link-requests', async (req, res) => {
  const filter = { kind: 'invitations', status: 'pending' };
  if (req.user.role === 'senior') filter.seniorId = req.user._id;
  else filter.createdBy = req.user._id;
  const items = await CareRecord.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ items });
});

router.post('/auth/link-requests/:id/approve', allowRoles('senior'), async (req, res) => {
  const invite = await CareRecord.findOne({ _id: req.params.id, kind: 'invitations', seniorId: req.user._id, status: 'pending' });
  if (!invite) return res.status(404).json({ error: 'Pending connection request not found.' });
  const requester = await User.findById(invite.createdBy);
  if (!requester) return res.status(404).json({ error: 'Requesting account no longer exists.' });
  await Promise.all([
    User.updateOne({ _id: req.user._id }, { $addToSet: { seniorIds: requester._id } }),
    User.updateOne({ _id: requester._id }, { $addToSet: { seniorIds: req.user._id } }),
  ]);
  invite.status = 'approved';
  invite.data = { ...invite.data.toObject?.() ?? invite.data, approvedBy: String(req.user._id), approvedAt: new Date().toISOString() };
  await invite.save();
  req.app.get('io').to(String(requester._id)).emit('care:update', { resource: 'invitations', item: invite });
  await writeAudit(req, 'approved', 'care-circle connection', invite._id);
  res.json({ message: `${requester.name} is now part of your care circle.` });
});

router.get('/dashboard', async (req, res) => {
  const selectedSeniorId = req.query.seniorId;
  if (selectedSeniorId && !canAccessSenior(req.user, selectedSeniorId)) return res.status(403).json({ error: 'You are not connected to that senior.' });
  const ids = selectedSeniorId ? [selectedSeniorId] : req.user.role === 'senior' ? [req.user._id] : req.user.seniorIds;
  if (req.user.role === 'admin' && !selectedSeniorId) {
    const ownRecords = { seniorId: { $in: [req.user._id, ...req.user.seniorIds] } };
    const organization = req.user.organizationId ? await Organization.findById(req.user.organizationId).select('memberIds').lean() : null;
    const [users, alerts, tasks, checkins, recent] = await Promise.all([
      User.countDocuments({ _id: { $in: organization?.memberIds || [req.user._id, ...req.user.seniorIds] } }),
      CareRecord.countDocuments({ ...ownRecords, kind: 'alerts', status: { $in: ['active', 'acknowledged'] } }),
      CareRecord.countDocuments({ ...ownRecords, kind: 'tasks', status: { $nin: ['completed', 'cancelled'] } }),
      CareRecord.countDocuments({ ...ownRecords, kind: 'checkins', status: 'scheduled' }),
      CareRecord.find({ kind: { $in: ['alerts', 'tasks', 'checkins'] }, ...ownRecords }).sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    return res.json({ counts: { users, alerts, medications: 0, tasks }, recent, checkins });
  }
  const [alerts, medications, tasks, shifts, locations, activity] = await Promise.all([
    CareRecord.find({ kind: 'alerts', seniorId: { $in: ids }, status: { $in: ['active', 'acknowledged'] } }).sort({ createdAt: -1 }).limit(10).lean(),
    CareRecord.find({ kind: 'medications', seniorId: { $in: ids }, status: 'active' }).sort({ createdAt: -1 }).limit(20).lean(),
    CareRecord.find({
      kind: 'tasks', seniorId: { $in: ids }, status: { $nin: ['completed', 'cancelled'] },
      ...(req.user.role === 'caregiver' ? { $or: [{ 'data.assignedTo': req.user._id }, { 'data.assignedTo': { $exists: false } }] } : {}),
    }).sort({ createdAt: 1 }).limit(20).lean(),
    CareRecord.find({ kind: 'shifts', seniorId: { $in: ids } }).sort({ createdAt: -1 }).limit(5).lean(),
    CareRecord.findOne({ kind: 'locations', seniorId: { $in: ids } }).sort({ createdAt: -1 }).lean(),
    CareRecord.find({ seniorId: { $in: ids } }).sort({ createdAt: -1 }).limit(12).lean(),
  ]);
  res.json({ counts: { alerts: alerts.length, medications: medications.length, tasks: tasks.length }, alerts, medications, tasks, shifts, location: locations, activity });
});

router.get('/people', async (req, res) => {
  if (req.user.role === 'admin') {
    if (req.query.seniorId && !canAccessSenior(req.user, String(req.query.seniorId))) {
      return res.status(403).json({ error: 'You are not connected to that senior.' });
    }
    if (req.query.seniorId) {
      const senior = await User.findOne({ _id: req.query.seniorId, role: 'senior' }).select('_id seniorIds');
      if (!senior) return res.status(404).json({ error: 'Senior account not found.' });
      const team = await User.find({ _id: { $in: [senior._id, ...senior.seniorIds] } }).select('name email role').lean();
      return res.json({ people: team.map((person) => ({ id: String(person._id), name: person.name, email: person.email, role: person.role })) });
    }
    const organization = req.user.organizationId ? await Organization.findById(req.user.organizationId).select('memberIds') : null;
    const users = await User.find({ _id: { $in: [req.user._id, ...(organization?.memberIds || []), ...req.user.seniorIds] } }).select('name email role').lean();
    return res.json({ people: users.map((person) => ({ id: String(person._id), name: person.name, email: person.email, role: person.role })) });
  }
  if (req.query.seniorId && !canAccessSenior(req.user, String(req.query.seniorId))) {
    return res.status(403).json({ error: 'You are not connected to that senior.' });
  }
  const linkedSeniors = req.query.seniorId
    ? await User.find({ _id: req.query.seniorId, role: 'senior' }).select('_id seniorIds').lean()
    : req.user.role === 'senior'
      ? [req.user]
      : await User.find({ _id: { $in: req.user.seniorIds }, role: 'senior' }).select('_id seniorIds').lean();
  const memberIds = new Set(linkedSeniors.flatMap((senior) => [String(senior._id), ...senior.seniorIds.map(String)]));
  const people = await User.find({ _id: { $in: [...memberIds] } }).select('name role').lean();
  res.json({ people: people.map((person) => ({ id: String(person._id), name: person.name, role: person.role })) });
});

router.get('/organization', allowRoles('admin'), async (req, res) => {
  if (!req.user.organizationId) return res.status(404).json({ error: 'Set up your organization first.' });
  const organization = await Organization.findById(req.user.organizationId).select('-invitations').lean();
  if (!organization) return res.status(404).json({ error: 'Organization not found.' });
  res.json({ organization });
});

router.post('/organization', allowRoles('admin'), async (req, res) => {
  if (req.user.organizationId) return res.status(409).json({ error: 'Your account already belongs to an organization.' });
  const parsed = schemas.organizations.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check the organization details.', details: parsed.error.flatten() });
  const organization = await Organization.create({ ...parsed.data, ownerId: req.user._id, memberIds: [req.user._id] });
  req.user.organizationId = organization._id;
  await req.user.save();
  await writeAudit(req, 'created', 'organization', organization._id);
  res.status(201).json({ organization });
});

router.patch('/organization', allowRoles('admin'), async (req, res) => {
  if (!req.user.organizationId) return res.status(404).json({ error: 'Set up your organization first.' });
  const parsed = schemas.organizations.partial().safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data || {}).length) return res.status(400).json({ error: 'Provide valid organization details.', details: parsed.success ? undefined : parsed.error.flatten() });
  const organization = await Organization.findOneAndUpdate({ _id: req.user.organizationId, ownerId: req.user._id }, { $set: parsed.data }, { new: true, runValidators: true });
  if (!organization) return res.status(403).json({ error: 'Only the organization owner can change organization settings.' });
  await writeAudit(req, 'updated', 'organization', organization._id);
  res.json({ organization });
});

router.get('/organizations/members', allowRoles('admin'), async (req, res) => {
  if (!req.user.organizationId) return res.status(404).json({ error: 'Set up your organization first.' });
  const organization = await Organization.findOne({ _id: req.user.organizationId, ownerId: req.user._id }).select('memberIds invitations').lean();
  if (!organization) return res.status(403).json({ error: 'Organization owner access is required.' });
  const members = await User.find({ _id: { $in: organization.memberIds } }).select('name email role createdAt').lean();
  res.json({
    members: members.map((person) => ({ id: String(person._id), name: person.name, email: person.email, role: person.role, joinedAt: person.createdAt })),
    invitations: organization.invitations.filter((invite) => invite.status === 'pending').map((invite) => ({ id: String(invite._id), email: invite.email, createdAt: invite.createdAt })),
  });
});

router.get('/organizations/invitations/mine', async (req, res) => {
  const organizations = await Organization.find({ 'invitations.userId': req.user._id, 'invitations.status': 'pending' }).select('name invitations').lean();
  const invitations = organizations.flatMap((organization) => organization.invitations
    .filter((invite) => String(invite.userId) === String(req.user._id) && invite.status === 'pending')
    .map((invite) => ({ id: String(invite._id), organizationName: organization.name, email: invite.email, createdAt: invite.createdAt })));
  res.json({ invitations });
});

router.post('/organizations/invitations', allowRoles('admin'), async (req, res) => {
  if (!req.user.organizationId) return res.status(404).json({ error: 'Set up your organization first.' });
  const parsed = z.object({ email: z.string().email().transform((email) => email.toLowerCase()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid registered staff email.' });
  const invitee = await User.findOne({ email: parsed.data.email }).select('_id role email');
  if (!invitee || !['caregiver', 'family'].includes(invitee.role)) return res.status(404).json({ error: 'A registered caregiver or family member with that email was not found.' });
  if (invitee.organizationId && String(invitee.organizationId) !== String(req.user.organizationId)) return res.status(409).json({ error: 'This person already belongs to another organization.' });
  const organization = await Organization.findOne({ _id: req.user.organizationId, ownerId: req.user._id });
  if (!organization) return res.status(403).json({ error: 'Organization owner access is required.' });
  if (organization.memberIds.some((id) => String(id) === String(invitee._id))) return res.status(409).json({ error: 'This person is already a member.' });
  if (organization.invitations.some((invite) => invite.status === 'pending' && String(invite.userId) === String(invitee._id))) return res.status(409).json({ error: 'An invitation is already pending.' });
  organization.invitations.push({ userId: invitee._id, email: invitee.email, invitedBy: req.user._id });
  await organization.save();
  req.app.get('io').to(String(invitee._id)).emit('care:update', { resource: 'invitations', event: 'organization:invited', organizationName: organization.name });
  await writeAudit(req, 'invited', 'organization member', invitee._id);
  res.status(202).json({ message: `Invitation sent in-app to ${invitee.email}. They must accept it before joining.`, delivery: 'in-app; email delivery is not configured' });
});

router.post('/organizations/invitations/:id/accept', async (req, res) => {
  const organization = await Organization.findOne({ 'invitations._id': req.params.id });
  if (!organization) return res.status(404).json({ error: 'Invitation not found.' });
  const invite = organization.invitations.id(req.params.id);
  if (String(invite.userId) !== String(req.user._id)) return res.status(403).json({ error: 'This invitation belongs to another account.' });
  if (invite.status !== 'pending') return res.status(409).json({ error: 'This invitation is no longer pending.' });
  if (!['caregiver', 'family'].includes(req.user.role)) return res.status(403).json({ error: 'This account role cannot join the organization.' });
  if (req.user.organizationId && String(req.user.organizationId) !== String(organization._id)) return res.status(409).json({ error: 'This account already belongs to another organization.' });
  invite.status = 'accepted';
  invite.acceptedAt = new Date();
  organization.memberIds.addToSet(req.user._id);
  await organization.save();
  req.user.organizationId = organization._id;
  await req.user.save();
  req.app.get('io').to(String(organization.ownerId)).emit('care:update', { resource: 'invitations', event: 'organization:accepted', userId: String(req.user._id) });
  res.json({ message: `You joined ${organization.name}. Senior health records still require an approved care-circle connection.` });
});

router.post('/organizations/invitations/:id/decline', async (req, res) => {
  const organization = await Organization.findOne({ 'invitations._id': req.params.id });
  if (!organization) return res.status(404).json({ error: 'Invitation not found.' });
  const invite = organization.invitations.id(req.params.id);
  if (String(invite.userId) !== String(req.user._id)) return res.status(403).json({ error: 'This invitation belongs to another account.' });
  if (invite.status !== 'pending') return res.status(409).json({ error: 'This invitation is no longer pending.' });
  invite.status = 'revoked';
  await organization.save();
  res.json({ message: 'Invitation declined.' });
});

router.delete('/organizations/members/:userId', allowRoles('admin'), async (req, res) => {
  if (!req.user.organizationId) return res.status(404).json({ error: 'Set up your organization first.' });
  if (String(req.user._id) === req.params.userId) return res.status(400).json({ error: 'The organization owner cannot remove themselves.' });
  const organization = await Organization.findOneAndUpdate(
    { _id: req.user.organizationId, ownerId: req.user._id, memberIds: req.params.userId },
    { $pull: { memberIds: req.params.userId } },
    { new: true },
  );
  if (!organization) return res.status(404).json({ error: 'Organization member not found.' });
  await User.updateOne({ _id: req.params.userId, organizationId: organization._id }, { $unset: { organizationId: 1 } });
  await writeAudit(req, 'removed', 'organization member', req.params.userId);
  res.json({ message: 'Organization member removed.' });
});

router.get('/resources', (req, res) => res.json({ resources: Object.keys(resourceRoles) }));

router.get('/video/ice-servers', (req, res) => {
  const iceServers = [{ urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' }];
  const turnUrls = (process.env.TURN_URLS || '').split(',').map((url) => url.trim()).filter(Boolean);
  if (turnUrls.length) {
    if (!process.env.TURN_SHARED_SECRET) {
      return res.status(503).json({ error: 'TURN is not configured. Contact your CareCircle administrator.' });
    }
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const username = `${expiresAt}:${req.user._id}`;
    const credential = createHmac('sha1', process.env.TURN_SHARED_SECRET).update(username).digest('base64');
    iceServers.push({ urls: turnUrls, username, credential });
  }
  res.json({ iceServers });
});

async function receiveDeviceEvent(req, res) {
  const parsed = z.object({
    eventId: z.string().trim().min(3).max(120),
    type: z.enum(['fall', 'inactivity']),
    occurredAt: z.coerce.date().optional(),
    confidence: z.number().min(0).max(1).optional(),
    details: z.record(z.unknown()).optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid device event.', details: parsed.error.flatten() });
  const record = await CareRecord.findOne({ _id: req.params.id, kind: 'devices', status: 'active' });
  if (!record) return res.status(404).json({ error: 'Active device not found.' });
  const suppliedKey = req.get('x-device-key') || '';
  const suppliedHash = createHash('sha256').update(suppliedKey).digest();
  const storedHash = Buffer.from(record.data.apiKeyHash || '', 'hex');
  if (storedHash.length !== suppliedHash.length || !timingSafeEqual(storedHash, suppliedHash)) {
    return res.status(401).json({ error: 'Invalid device credentials.' });
  }
  const duplicate = await CareRecord.findOne({ kind: 'alerts', seniorId: record.seniorId, 'data.deviceId': String(record._id), 'data.deviceEventId': parsed.data.eventId });
  if (duplicate) return res.status(200).json({ item: duplicate, duplicate: true });
  const rule = await CareRecord.findOne({ kind: 'alertRules', seniorId: record.seniorId, status: 'active', 'data.eventType': parsed.data.type }).sort({ createdAt: -1 });
  const alert = await CareRecord.create({
    kind: 'alerts', seniorId: record.seniorId, createdBy: record.createdBy,
    status: 'active',
    occurredAt: parsed.data.occurredAt || new Date(),
    data: {
      type: parsed.data.type, severity: rule?.data.severity || (parsed.data.type === 'fall' ? 'critical' : 'warning'),
      message: parsed.data.type === 'fall' ? 'A fall event was reported by a connected device.' : 'A connected device reported inactivity.',
      source: record.data.name, deviceId: String(record._id), deviceEventId: parsed.data.eventId,
      confidence: parsed.data.confidence, details: parsed.data.details || {},
    },
  });
  record.data.lastSeenAt = new Date().toISOString();
  await record.save();
  req.app.get('io').to(String(record.seniorId)).emit('care:update', { resource: 'alerts', event: 'alert:new', item: alert });
  await CareRecord.create({
    kind: 'activity', seniorId: record.seniorId, createdBy: record.createdBy, status: 'logged',
    data: { actor: 'Connected device', action: 'reported', target: 'device alert', targetId: String(alert._id) },
  });
  res.status(201).json({ item: alert });
}

router.get('/:resource', async (req, res) => {
  const { resource } = req.params;
  if (!resourceRoles[resource]) return res.status(404).json({ error: 'Resource not found.' });
  if (!resourceRoles[resource].includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to view this resource.' });
  const requestedSenior = req.query.seniorId;
  const seniorIds = req.user.role === 'senior' ? [req.user._id] : req.user.role === 'admin' ? null : req.user.seniorIds;
  let seniorId = requestedSenior;
  if (seniorId && !canAccessSenior(req.user, seniorId)) return res.status(403).json({ error: 'You are not connected to that senior.' });
  if (!seniorId && seniorIds?.length === 1) seniorId = String(seniorIds[0]);
  if (!seniorId && seniorIds) return res.status(400).json({ error: 'Choose a linked senior first.' });
  const filter = { kind: resource };
  if (seniorId) filter.seniorId = seniorId;
  else if (req.user.role === 'admin') filter.seniorId = { $in: [req.user._id, ...req.user.seniorIds] };
  if (resource === 'tasks' && req.user.role === 'caregiver') {
    filter.$or = [{ 'data.assignedTo': req.user._id }, { 'data.assignedTo': { $exists: false } }];
  }
  if (resource === 'careNotes' && req.user.role === 'family') filter['data.visibility'] = 'family';
  if (req.query.status) filter.status = String(req.query.status).slice(0, 40);
  const page = Math.max(1, Math.min(100, Number(req.query.page) || 1));
  const [records, total] = await Promise.all([
    CareRecord.find(filter).sort({ occurredAt: -1 }).skip((page - 1) * 50).limit(50).lean(),
    CareRecord.countDocuments(filter),
  ]);
  if (resource === 'devices') records.forEach((item) => { delete item.data.apiKeyHash; });
  res.json({ items: records, page, pageSize: 50, total, hasMore: page * 50 < total });
});

router.get('/reports/summary', async (req, res) => {
  const seniorId = req.query.seniorId || (req.user.role === 'senior' ? String(req.user._id) : req.user.seniorIds.length === 1 ? String(req.user.seniorIds[0]) : null);
  if (!seniorId) return res.status(400).json({ error: 'Choose a linked senior.' });
  if (!canAccessSenior(req.user, seniorId)) return res.status(403).json({ error: 'You are not connected to that senior.' });
  const start = new Date(Date.now() - 7 * 86400000);
  const rows = await CareRecord.aggregate([
    { $match: { seniorId: new mongoose.Types.ObjectId(seniorId), createdAt: { $gte: start } } },
    { $group: { _id: '$kind', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $in: ['$status', ['completed', 'taken']] }, 1, 0] } } } },
  ]);
  res.json({ range: 'last 7 days', totals: Object.fromEntries(rows.map((row) => [row._id, { total: row.total, completed: row.completed }])) });
});

router.get('/vitals/trends', async (req, res) => {
  const seniorId = req.query.seniorId || (req.user.role === 'senior' ? String(req.user._id) : req.user.seniorIds.length === 1 ? String(req.user.seniorIds[0]) : null);
  if (!seniorId) return res.status(400).json({ error: 'Choose a linked senior.' });
  if (!canAccessSenior(req.user, seniorId)) return res.status(403).json({ error: 'You are not connected to that senior.' });
  const filter = z.object({
    type: z.enum(['bloodPressure', 'heartRate', 'temperature', 'weight', 'bloodGlucose', 'oxygenSaturation']).optional(),
    days: z.coerce.number().int().min(1).max(365).default(30),
  }).safeParse(req.query);
  if (!filter.success) return res.status(400).json({ error: 'Invalid vital trend filters.', details: filter.error.flatten() });
  const start = new Date(Date.now() - filter.data.days * 86400000);
  const query = { kind: 'vitals', seniorId, occurredAt: { $gte: start } };
  if (filter.data.type) query['data.type'] = filter.data.type;
  const measurements = await CareRecord.find(query).sort({ occurredAt: 1 }).limit(2000).lean();
  res.json({ days: filter.data.days, measurements });
});

router.post('/medications/:id/events', async (req, res) => {
  if (!resourceRoles.medicationEvents.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to record medication activity.' });
  const medication = await CareRecord.findOne({ _id: req.params.id, kind: 'medications' });
  if (!medication) return res.status(404).json({ error: 'Medication not found.' });
  if (!canAccessSenior(req.user, medication.seniorId)) return res.status(403).json({ error: 'You are not connected to that senior.' });
  const parsed = z.object({ type: z.enum(['taken', 'missed', 'skipped']), notes: z.string().max(500).optional(), occurredAt: z.coerce.date().optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid medication event.', details: parsed.error.flatten() });
  const event = await CareRecord.create({
    kind: 'medicationEvents', seniorId: medication.seniorId, createdBy: req.user._id,
    status: parsed.data.type, occurredAt: parsed.data.occurredAt || new Date(),
    data: { medicationId: String(medication._id), name: medication.data.name, dose: medication.data.dose, type: parsed.data.type, notes: parsed.data.notes || '' },
  });
  req.app.get('io').to(String(medication.seniorId)).emit('care:update', { resource: 'medicationEvents', item: event });
  await writeAudit(req, 'recorded', 'medication event', event._id);
  res.status(201).json({ item: event });
});

router.get('/reports/export.csv', async (req, res) => {
  const seniorId = req.query.seniorId || (req.user.role === 'senior' ? String(req.user._id) : req.user.seniorIds.length === 1 ? String(req.user.seniorIds[0]) : null);
  if (!seniorId) return res.status(400).json({ error: 'Choose a linked senior.' });
  if (!canAccessSenior(req.user, seniorId)) return res.status(403).json({ error: 'You are not connected to that senior.' });
  const parsed = z.object({
    start: z.coerce.date().optional(), end: z.coerce.date().optional(),
    kind: z.enum(['alerts', 'medications', 'medicationEvents', 'vitals', 'tasks', 'appointments', 'checkins']).optional(),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid report filters.', details: parsed.error.flatten() });
  const start = parsed.data.start || new Date(Date.now() - 7 * 86400000);
  const end = parsed.data.end || new Date();
  if (start > end || end.getTime() - start.getTime() > 366 * 86400000) return res.status(400).json({ error: 'Choose a valid report range no longer than one year.' });
  const filter = { seniorId, occurredAt: { $gte: start, $lte: end } };
  if (parsed.data.kind) filter.kind = parsed.data.kind;
  const items = await CareRecord.find(filter).sort({ occurredAt: 1 }).limit(10000).lean();
  const escape = (value) => {
    let cell = String(value ?? '').replace(/[\r\n]+/g, ' ');
    if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
  };
  const rows = [
    ['Date', 'Category', 'Status', 'Summary', 'Details'],
    ...items.map((item) => [
      item.occurredAt?.toISOString(), item.kind, item.status,
      item.data.message || item.data.title || item.data.name || item.data.type || '',
      JSON.stringify(item.data),
    ]),
  ];
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="carecircle-report.csv"', 'Cache-Control': 'no-store' });
  res.send(rows.map((row) => row.map(escape).join(',')).join('\r\n'));
});

router.get('/:resource/:id', async (req, res) => {
  const { resource, id } = req.params;
  if (!resourceRoles[resource]) return res.status(404).json({ error: 'Resource not found.' });
  if (!resourceRoles[resource].includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to view this resource.' });
  const record = await CareRecord.findOne({ _id: id, kind: resource });
  if (!record) return res.status(404).json({ error: 'Record not found.' });
  if (!canAccessSenior(req.user, record.seniorId)) return res.status(403).json({ error: 'You are not connected to that senior.' });
  if (resource === 'careNotes' && req.user.role === 'family' && record.data.visibility !== 'family') return res.status(404).json({ error: 'Record not found.' });
  if (resource === 'devices') delete record.data.apiKeyHash;
  res.json({ item: record });
});



router.post('/emergency', async (req, res) => {
  const parsed = z.object({ seniorId: z.string().optional(), message: z.string().trim().max(500).default('Emergency assistance requested.') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid emergency request.' });
  const seniorId = req.user.role === 'senior' ? String(req.user._id) : parsed.data.seniorId || (req.user.seniorIds.length === 1 ? String(req.user.seniorIds[0]) : null);
  if (!seniorId) return res.status(400).json({ error: 'Choose a linked senior.' });
  if (!canAccessSenior(req.user, seniorId)) return res.status(403).json({ error: 'You are not connected to that senior.' });
  const record = await CareRecord.create({
    kind: 'alerts', seniorId, createdBy: req.user._id, status: 'active',
    data: { type: 'emergency', severity: 'critical', message: parsed.data.message, source: 'manual', delivery: 'in-app only; external contact delivery is not configured' },
  });
  await notifySeniorRoom(req, seniorId, { resource: 'alerts', event: 'emergency:new', item: record });
  await writeAudit(req, 'created', 'emergency', record._id);
  res.status(201).json({ item: record, delivery: 'In-app alert created. SMS and phone delivery require a configured provider.' });
});

router.post('/:resource', async (req, res, next) => {
  try {
    const { resource } = req.params;
    if (!resourceRoles[resource]) return res.status(404).json({ error: 'Resource not found.' });
    if (resource === 'activity') return res.status(403).json({ error: 'Audit activity is recorded automatically.' });
    if (!resourceRoles[resource].includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to create this resource.' });
    const parsed = recordInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid resource data.', details: parsed.error.flatten() });
    const dataSchema = schemas[resource];
    if (dataSchema) {
      const validatedData = dataSchema.safeParse(parsed.data.data);
      if (!validatedData.success) return res.status(400).json({ error: 'Check the resource details.', details: validatedData.error.flatten() });
      parsed.data.data = validatedData.data;
    }
    let seniorId = parsed.data.seniorId;
    if (req.user.role === 'senior') seniorId = String(req.user._id);
    else if (!seniorId && req.user.seniorIds.length === 1) seniorId = String(req.user.seniorIds[0]);
    if (!seniorId && req.user.role === 'admin') seniorId = String(req.user._id);
    if (!seniorId && req.user.role !== 'admin') return res.status(400).json({ error: 'Choose a linked senior.' });
    if (seniorId && !canAccessSenior(req.user, seniorId)) return res.status(403).json({ error: 'You are not connected to that senior.' });
    if (parsed.data.status && validStatuses[resource] && !validStatuses[resource].includes(parsed.data.status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses[resource].join(', ')}.` });
    }
    if (resource === 'tasks' && parsed.data.data.assignedTo) {
      const caregiver = await User.findOne({ _id: parsed.data.data.assignedTo, role: 'caregiver' }).select('_id seniorIds');
      if (!caregiver || !caregiver.seniorIds.some((id) => String(id) === String(seniorId))) {
        return res.status(400).json({ error: 'Choose a caregiver who has been approved for this senior.' });
      }
      parsed.data.data.assignedTo = String(caregiver._id);
    }
    if (resource === 'paymentEvents') {
      const invoice = await CareRecord.findOne({ _id: parsed.data.data.invoiceId, kind: 'invoices', seniorId });
      if (!invoice) return res.status(404).json({ error: 'Invoice not found in this care account.' });
      if (['paid', 'cancelled'].includes(invoice.status)) return res.status(409).json({ error: 'This invoice is already settled or cancelled.' });
    }
    let integrationKey;
    const recordData = parsed.data.data;
    if (resource === 'devices') {
      integrationKey = randomBytes(32).toString('base64url');
      recordData.apiKeyHash = createHash('sha256').update(integrationKey).digest('hex');
    }
    const record = await CareRecord.create({
      kind: resource, seniorId, createdBy: req.user._id, data: recordData,
      status: parsed.data.status || (resource === 'tasks' || resource === 'invitations' ? 'pending' : resource === 'appointments' ? 'scheduled' : resource === 'paymentEvents' ? 'requires-provider' : resource === 'medicationEvents' ? parsed.data.data.type : 'active'),
      occurredAt: parsed.data.occurredAt || new Date(),
    });
    req.app.get('io').to(String(seniorId)).emit('care:update', { resource, item: record });
    await writeAudit(req, 'created', resource, record._id);
    if (resource === 'locations') await evaluateGeofence(req, record);
    if (resource === 'alerts') await notifySeniorRoom(req, seniorId, { resource, item: record, event: 'alert:new' });
    const responseRecord = record.toObject();
    if (resource === 'devices') delete responseRecord.data.apiKeyHash;
    res.status(201).json({ item: responseRecord, ...(integrationKey ? { integrationKey } : {}) });
  } catch (error) { next(error); }
});

router.patch('/:resource/:id', async (req, res) => {
  const { resource, id } = req.params;
  if (!resourceRoles[resource]) return res.status(404).json({ error: 'Resource not found.' });
  if (resource === 'activity') return res.status(403).json({ error: 'Audit activity cannot be updated.' });
  if (!resourceRoles[resource].includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to update this resource.' });
  const parsed = z.object({ status: z.string().max(40).optional(), data: z.record(z.unknown()).optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid update.', details: parsed.error.flatten() });
  const record = await CareRecord.findOne({ _id: id, kind: resource });
  if (!record) return res.status(404).json({ error: 'Record not found.' });
  if (!canAccessSenior(req.user, record.seniorId)) return res.status(403).json({ error: 'You are not connected to that senior.' });
  if (resource === 'careNotes' && req.user.role === 'family' && record.data.visibility !== 'family') return res.status(404).json({ error: 'Record not found.' });
  if (parsed.data.status && validStatuses[resource] && !validStatuses[resource].includes(parsed.data.status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses[resource].join(', ')}.` });
  }
  if (parsed.data.status && parsed.data.status !== record.status && statusTransitions[resource]) {
    const allowed = statusTransitions[resource][record.status] || [];
    if (!allowed.includes(parsed.data.status)) return res.status(409).json({ error: `Cannot change ${resource} from ${record.status} to ${parsed.data.status}.` });
  }
  if (resource === 'invoices' && parsed.data.status === 'paid') {
    const paymentData = { ...record.data.toObject?.() ?? record.data, ...parsed.data.data };
    if (paymentData.paymentMethod !== 'offline' || !paymentData.paymentReference?.trim()) {
      return res.status(400).json({ error: 'Record an offline payment method and reference before marking this invoice paid.' });
    }
  }
  if (parsed.data.status) record.status = parsed.data.status;
  if (parsed.data.data) {
    const merged = { ...record.data.toObject?.() ?? record.data, ...parsed.data.data };
    if (resource === 'tasks' && merged.assignedTo) {
      const caregiver = await User.findOne({ _id: merged.assignedTo, role: 'caregiver' }).select('_id seniorIds');
      if (!caregiver || !caregiver.seniorIds.some((seniorId) => String(seniorId) === String(record.seniorId))) {
        return res.status(400).json({ error: 'Choose a caregiver who has been approved for this senior.' });
      }
      merged.assignedTo = String(caregiver._id);
    }
    const dataSchema = schemas[resource];
    if (dataSchema) {
      const deviceKeyHash = resource === 'devices' ? merged.apiKeyHash : undefined;
      if (resource === 'devices') delete merged.apiKeyHash;
      const validated = dataSchema.safeParse(merged);
      if (!validated.success) return res.status(400).json({ error: 'Check the updated resource details.', details: validated.error.flatten() });
      record.data = { ...validated.data, ...(deviceKeyHash ? { apiKeyHash: deviceKeyHash } : {}) };
    } else record.data = merged;
  }
  await record.save();
  await writeAudit(req, 'updated', resource, record._id);
  req.app.get('io').to(String(record.seniorId)).emit('care:update', { resource, item: record });
  res.json({ item: record });
});

router.delete('/:resource/:id', async (req, res) => {
  const { resource, id } = req.params;
  if (!resourceRoles[resource]) return res.status(404).json({ error: 'Resource not found.' });
  if (resource === 'activity') return res.status(403).json({ error: 'Audit activity cannot be deleted.' });
  if (!['admin', 'caregiver'].includes(req.user.role)) return res.status(403).json({ error: 'Only an administrator or caregiver can remove records.' });
  const record = await CareRecord.findOne({ _id: id, kind: resource });
  if (!record) return res.status(404).json({ error: 'Record not found.' });
  if (!canAccessSenior(req.user, record.seniorId)) return res.status(403).json({ error: 'You are not connected to that senior.' });
  await record.deleteOne();
  await writeAudit(req, 'deleted', resource, id);
  res.json({ message: 'Record removed.' });
});

router.post('/video/signal', async (req, res) => {
  const parsed = z.object({
    room: z.string().min(3).max(100),
    targetUserId: z.string().optional(),
    signal: z.record(z.unknown()),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid video signaling payload.' });
  const seniorId = req.user.role === 'senior' ? String(req.user._id) : parsed.data.room;
  if (!canAccessSenior(req.user, seniorId)) return res.status(403).json({ error: 'You are not connected to that senior.' });
  if (parsed.data.targetUserId) {
    const target = await User.findById(parsed.data.targetUserId).select('_id seniorIds');
    if (!target || String(target._id) !== String(seniorId) && !target.seniorIds.some((id) => String(id) === String(seniorId))) {
      return res.status(403).json({ error: 'The video participant is not in this care circle.' });
    }
  }
  const payload = { from: String(req.user._id), seniorId: String(seniorId), signal: parsed.data.signal };
  const io = req.app.get('io');
  if (parsed.data.targetUserId) io.to(parsed.data.targetUserId).emit('video:signal', payload);
  else io.to(seniorId).emit('video:signal', payload);
  res.status(202).json({ message: 'Video signaling message delivered to the in-app session.' });
});

async function writeAudit(req, action, target, targetId) {
  await CareRecord.create({
    kind: 'activity', seniorId: req.user.role === 'senior' ? req.user._id : req.user.seniorIds[0] || req.user._id,
    createdBy: req.user._id, data: { actor: req.user.name, action, target, targetId: String(targetId) }, status: 'logged',
  });
}
async function notifySeniorRoom(req, seniorId, payload) {
  req.app.get('io').to(String(seniorId)).emit('care:update', payload);
}
async function evaluateGeofence(req, location) {
  const fences = await CareRecord.find({ kind: 'geofences', seniorId: location.seniorId, status: 'active' }).lean();
  const { latitude, longitude } = location.data;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
  for (const fence of fences) {
    const { latitude: centerLat, longitude: centerLon, radiusMeters = 250 } = fence.data;
    const distance = haversine(latitude, longitude, centerLat, centerLon);
    const alertFilter = {
      kind: 'alerts', seniorId: location.seniorId, status: { $in: ['active', 'acknowledged'] },
      'data.type': 'geofence', 'data.fenceId': String(fence._id),
    };
    if (distance > radiusMeters) {
      const existing = await CareRecord.exists(alertFilter);
      if (!existing) {
        const alert = await CareRecord.create({
          kind: 'alerts', seniorId: location.seniorId, createdBy: req.user._id,
          data: { type: 'geofence', fenceId: String(fence._id), severity: 'warning', message: `Outside safe zone: ${fence.data.name || 'Home'}`, distanceMeters: Math.round(distance) },
        });
        await notifySeniorRoom(req, location.seniorId, { resource: 'alerts', event: 'alert:new', item: alert });
      }
    } else {
      const alerts = await CareRecord.find(alertFilter);
      for (const alert of alerts) {
        alert.status = 'resolved';
        await alert.save();
        await notifySeniorRoom(req, location.seniorId, { resource: 'alerts', event: 'alert:resolved', item: alert });
      }
    }
  }
}
function haversine(lat1, lon1, lat2, lon2) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default router;
