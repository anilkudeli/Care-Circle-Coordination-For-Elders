import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from './models/User.js';
import CareRecord from './models/CareRecord.js';
import Organization from './models/Organization.js';

const configs = [
  ['SEED_SENIOR_EMAIL', 'SEED_SENIOR_PASSWORD', 'Martha Bennett', 'senior'],
  ['SEED_FAMILY_EMAIL', 'SEED_FAMILY_PASSWORD', 'Jamie Bennett', 'family'],
  ['SEED_CAREGIVER_EMAIL', 'SEED_CAREGIVER_PASSWORD', 'Riley Carter', 'caregiver'],
  ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'CareCircle Admin', 'admin'],
];
for (const [emailKey, passwordKey] of configs) {
  if (!process.env[emailKey] || (process.env[passwordKey] || '').length < 12) {
    throw new Error(`${emailKey} and a ${passwordKey} of at least 12 characters are required.`);
  }
}

await mongoose.connect(process.env.MONGODB_URI);
try {
  const people = {};
  for (const [emailKey, passwordKey, name, role] of configs) {
    const email = process.env[emailKey].toLowerCase();
    people[role] = await User.findOneAndUpdate(
      { email },
      { $setOnInsert: { name, email, role, passwordHash: await bcrypt.hash(process.env[passwordKey], 12) } },
      { upsert: true, new: true },
    );
  }
  await Promise.all([
    User.updateOne({ _id: people.senior._id }, { $addToSet: { seniorIds: { $each: [people.family._id, people.caregiver._id, people.admin._id] } } }),
    User.updateOne({ _id: people.family._id }, { $addToSet: { seniorIds: people.senior._id } }),
    User.updateOne({ _id: people.caregiver._id }, { $addToSet: { seniorIds: people.senior._id } }),
    User.updateOne({ _id: people.admin._id }, { $addToSet: { seniorIds: people.senior._id } }),
  ]);
  let organization = await Organization.findOne({ ownerId: people.admin._id });
  if (!organization) organization = await Organization.create({
    name: 'CareCircle Demo Agency', ownerId: people.admin._id,
    memberIds: [people.admin._id, people.caregiver._id],
    currency: 'USD', contactEmail: people.admin.email,
  });
  await Promise.all([
    User.updateOne({ _id: people.admin._id }, { $set: { organizationId: organization._id } }),
    User.updateOne({ _id: people.caregiver._id }, { $set: { organizationId: organization._id } }),
  ]);

  const examples = [
    ['medications', 'active', { name: 'Vitamin D', dose: '1 tablet', schedule: 'Daily at 9:00 AM' }],
    ['tasks', 'pending', { title: 'Morning wellness check', description: 'Check in and note how the morning is going.', priority: 'normal' }],
    ['shifts', 'scheduled', { caregiver: people.caregiver.name, startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 5 * 3600000).toISOString() }],
    ['geofences', 'active', { name: 'Home', latitude: 37.7749, longitude: -122.4194, radiusMeters: 400 }],
    ['checkins', 'scheduled', { title: 'Family catch-up', scheduledAt: new Date(Date.now() + 86400000).toISOString(), method: 'video' }],
  ];
  for (const [kind, status, data] of examples) {
    const uniqueValue = data.name || data.title;
    const existing = await CareRecord.exists({ kind, seniorId: people.senior._id, [`data.${data.name ? 'name' : 'title'}`]: uniqueValue });
    if (!existing) await CareRecord.create({ kind, status, data, seniorId: people.senior._id, createdBy: people.admin._id });
  }
  console.log('CareCircle seed data is ready. Seeded account passwords are supplied via your environment only.');
} finally {
  await mongoose.disconnect();
}
