import mongoose from 'mongoose';

const invitationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  email: { type: String, required: true, lowercase: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'revoked'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  acceptedAt: Date,
}, { _id: true });

const organizationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  memberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  invitations: [invitationSchema],
  address: { type: String, maxlength: 250, default: '' },
  contactEmail: { type: String, lowercase: true, maxlength: 200, default: '' },
  currency: { type: String, enum: ['USD', 'CAD', 'GBP', 'EUR', 'AUD'], default: 'USD' },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

organizationSchema.index({ memberIds: 1 });

export default mongoose.model('Organization', organizationSchema);
