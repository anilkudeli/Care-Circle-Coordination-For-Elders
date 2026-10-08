import mongoose from 'mongoose';

const careRecordSchema = new mongoose.Schema({
  kind: { type: String, required: true, index: true },
  seniorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, default: 'active', index: true },
  occurredAt: { type: Date, default: Date.now },
}, { timestamps: true, strict: true });

careRecordSchema.index({ kind: 1, seniorId: 1, createdAt: -1 });
careRecordSchema.index(
  { 'data.reminderKey': 1 },
  { unique: true, partialFilterExpression: { kind: 'notifications', 'data.reminderKey': { $type: 'string' } } },
);

export default mongoose.model('CareRecord', careRecordSchema);
