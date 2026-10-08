import { z } from 'zod';

const phoneNumber = z.string()
  .trim()
  .min(7)
  .max(24)
  .regex(/^\+?[0-9\s().-]+$/)
  .refine((value) => {
    const digits = value.replace(/\D/g, '').length;
    return digits >= 7 && digits <= 15;
  });

export const usernameInput = z.string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])$/);

const strongPassword = z.string()
  .min(10)
  .max(128)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/\d/);

export const registerInput = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(200),
  username: z.preprocess((value) => value === '' ? undefined : value, usernameInput.optional()),
  phone: phoneNumber,
  password: strongPassword,
  role: z.enum(['senior', 'family', 'caregiver']),
}).strict();

export const loginInput = z.object({
  email: z.string().trim().min(1).max(200).optional(),
  username: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(1).max(128),
}).strict().refine(
  (data) => Boolean(data.email) !== Boolean(data.username),
);

export const forgotPasswordInput = z.object({
  email: z.string().trim().email().max(200),
}).strict();

export const resetPasswordInput = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: strongPassword,
}).strict();

export const profileInput = z.object({
  name: z.string().trim().min(2).max(100),
  phone: phoneNumber,
}).strict();

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: strongPassword,
}).strict().refine((data) => data.currentPassword !== data.newPassword, {
  message: 'Choose a new password different from the current password.',
  path: ['newPassword'],
});
