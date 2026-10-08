import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  username: {
    type: String, lowercase: true, trim: true, minlength: 3, maxlength: 30,
    match: /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])$/,
    unique: true, sparse: true,
  },
  phone: { type: String, trim: true, default: '' },
  passwordHash: { type: String, required: true, select: false },
  passwordResetTokenHash: { type: String, select: false },
  passwordResetExpiresAt: { type: Date, select: false },
  role: { type: String, enum: ['senior', 'family', 'caregiver', 'admin'], required: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
  seniorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  emergencyContacts: [{ name: String, phone: String, relationship: String }],
  notificationPreferences: {
    alerts: { type: Boolean, default: true },
    medicationReminders: { type: Boolean, default: true },
    careUpdates: { type: Boolean, default: true },
    invitations: { type: Boolean, default: true },
  },
  lastActivityAt: { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model('User', userSchema);
