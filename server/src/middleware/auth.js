import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export async function authenticate(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'Session is no longer valid.' });
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    next(error);
  }
}

export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to do that.' });
    next();
  };
}

export function canAccessSenior(user, seniorId) {
  if (user.role === 'senior') return String(user._id) === String(seniorId);
  return user.seniorIds.some((id) => String(id) === String(seniorId))
    || user.role === 'admin' && String(user._id) === String(seniorId);
}
