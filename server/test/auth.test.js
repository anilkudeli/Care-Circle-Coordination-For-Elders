import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, canAccessSenior } from '../src/middleware/auth.js';
import api from '../src/routes/api.js';
import { createPasswordResetToken, hashPasswordResetToken, PASSWORD_RESET_TTL_MS } from '../src/auth/passwordReset.js';
import {
  changePasswordInput, forgotPasswordInput, loginInput, profileInput, registerInput, resetPasswordInput,
} from '../src/auth/schemas.js';
import { isEmailProviderConfigured } from '../src/services/email.js';

test('senior can access only their own records', () => {
  assert.equal(canAccessSenior({ role: 'senior', _id: 'senior-1', seniorIds: [] }, 'senior-1'), true);
  assert.equal(canAccessSenior({ role: 'senior', _id: 'senior-1', seniorIds: [] }, 'senior-2'), false);
});

test('family and caregivers can access only explicitly linked seniors', () => {
  const family = { role: 'family', _id: 'family-1', seniorIds: ['senior-1'] };
  assert.equal(canAccessSenior(family, 'senior-1'), true);
  assert.equal(canAccessSenior(family, 'senior-2'), false);
});

test('administrators can access their own organization records and approved senior records only', () => {
  const admin = { role: 'admin', _id: 'admin-1', seniorIds: ['senior-1'] };
  assert.equal(canAccessSenior(admin, 'admin-1'), true);
  assert.equal(canAccessSenior(admin, 'senior-1'), true);
  assert.equal(canAccessSenior(admin, 'senior-2'), false);
  assert.equal(canAccessSenior(admin, 'admin-2'), false);
});

test('specific report and emergency routes are registered before dynamic resource routes', () => {
  const routes = api.stack
    .filter((layer) => layer.route)
    .map((layer) => ({ path: layer.route.path, methods: layer.route.methods }));
  const indexOf = (path, method) => routes.findIndex((route) => route.path === path && route.methods[method]);
  assert.ok(indexOf('/reports/summary', 'get') < indexOf('/:resource/:id', 'get'));
  assert.ok(indexOf('/emergency', 'post') < indexOf('/:resource', 'post'));
});

test('device-key intake is registered before JWT authentication middleware', () => {
  const deviceRouteIndex = api.stack.findIndex((layer) => layer.route?.path === '/integrations/devices/:id/events');
  const authMiddlewareIndex = api.stack.findIndex((layer) => !layer.route);
  assert.ok(deviceRouteIndex >= 0);
  assert.ok(authMiddlewareIndex > deviceRouteIndex);
});

test('registration requires a validated phone number', () => {
  const base = { name: 'Taylor Care', email: 'taylor@example.test', password: 'A-long-password1', role: 'family' };
  assert.equal(registerInput.safeParse({ ...base, phone: '+1 (415) 555-0132' }).success, true);
  assert.equal(registerInput.safeParse(base).success, false);
  assert.equal(registerInput.safeParse({ ...base, phone: '123' }).success, false);
  assert.equal(registerInput.safeParse({ ...base, phone: 'letters-only' }).success, false);
});

test('registration optionally normalizes unique usernames and login accepts email or username', () => {
  const base = {
    name: 'Taylor Care', email: 'taylor@example.test', phone: '+1 (415) 555-0132',
    password: 'A-long-password1', role: 'family',
  };
  const withUsername = registerInput.safeParse({ ...base, username: 'Taylor.Care_1' });
  assert.equal(withUsername.success, true);
  assert.equal(withUsername.data.username, 'taylor.care_1');
  assert.equal(registerInput.safeParse(base).success, true);
  assert.equal(registerInput.safeParse({ ...base, username: 'ab' }).success, false);
  assert.equal(registerInput.safeParse({ ...base, username: '.invalid' }).success, false);

  assert.equal(loginInput.safeParse({ email: 'person@example.test', password: 'secret' }).success, true);
  assert.equal(loginInput.safeParse({ email: 'ExistingUser', password: 'secret' }).success, true);
  assert.equal(loginInput.safeParse({ username: 'New.User', password: 'secret' }).success, true);
  assert.equal(loginInput.safeParse({ password: 'secret' }).success, false);
  assert.equal(loginInput.safeParse({
    email: 'person@example.test', username: 'person', password: 'secret',
  }).success, false);
});

test('password reset tokens are random, hashed for storage, and expire after one hour', () => {
  const issuedAt = 1_800_000_000_000;
  const first = createPasswordResetToken(issuedAt);
  const second = createPasswordResetToken(issuedAt);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash, hashPasswordResetToken(first.token));
  assert.notEqual(first.tokenHash, first.token);
  assert.equal(first.tokenHash.length, 64);
  assert.equal(first.expiresAt.getTime(), issuedAt + PASSWORD_RESET_TTL_MS);
});

test('forgot and reset password request bodies are validated without unknown fields', () => {
  assert.equal(forgotPasswordInput.safeParse({ email: 'person@example.test' }).success, true);
  assert.equal(forgotPasswordInput.safeParse({ email: 'not-an-email' }).success, false);
  assert.equal(resetPasswordInput.safeParse({
    token: 'a'.repeat(43), password: 'A-new-long-password1',
  }).success, true);
  assert.equal(resetPasswordInput.safeParse({
    token: 'short', password: 'A-new-long-password1',
  }).success, false);
  assert.equal(resetPasswordInput.safeParse({
    token: 'a'.repeat(43), password: 'a-new-long-password',
  }).success, false);
  assert.equal(resetPasswordInput.safeParse({
    token: 'a'.repeat(43), password: 'A-new-long-password1', email: 'person@example.test',
  }).success, false);
});

test('profile and password changes validate their entire request bodies', () => {
  assert.equal(profileInput.safeParse({ name: 'Taylor Care', phone: '+1 415 555 0132' }).success, true);
  assert.equal(profileInput.safeParse({ name: 'Taylor Care', phone: '123' }).success, false);
  assert.equal(profileInput.safeParse({ name: 'Taylor Care', phone: '+1 415 555 0132', role: 'admin' }).success, false);
  assert.equal(changePasswordInput.safeParse({
    currentPassword: 'OldPass1234', newPassword: 'NewPass1234',
  }).success, true);
  assert.equal(changePasswordInput.safeParse({
    currentPassword: 'OldPass1234', newPassword: 'weak-password',
  }).success, false);
  assert.equal(changePasswordInput.safeParse({
    currentPassword: 'OldPass1234', newPassword: 'OldPass1234',
  }).success, false);
});

test('email provider configuration requires complete valid SMTP settings', () => {
  const complete = {
    SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_USER: 'mailer',
    SMTP_PASS: 'not-a-real-secret', SMTP_FROM: 'CareCircle <care@example.test>',
  };
  assert.equal(isEmailProviderConfigured(complete), true);
  assert.equal(isEmailProviderConfigured({ ...complete, SMTP_PASS: '' }), false);
  assert.equal(isEmailProviderConfigured({ ...complete, SMTP_PORT: '70000' }), false);
});

test('forgot and reset endpoints are public and registered before JWT authentication', () => {
  const layers = api.stack;
  const authMiddlewareIndex = layers.findIndex((layer) => !layer.route);
  for (const path of ['/auth/forgot-password', '/auth/reset-password']) {
    const routeIndex = layers.findIndex((layer) => layer.route?.path === path && layer.route.methods.post);
    assert.ok(routeIndex >= 0, `${path} is registered`);
    assert.ok(routeIndex < authMiddlewareIndex, `${path} precedes authenticate middleware`);
  }
});

test('profile editing and password changes are authenticated routes', () => {
  for (const [path, method] of [['/auth/profile', 'patch'], ['/auth/change-password', 'post']]) {
    const route = api.stack.find((layer) => layer.route?.path === path && layer.route.methods[method])?.route;
    assert.ok(route, `${path} is registered`);
    assert.ok(route.stack.some((layer) => layer.handle === authenticate), `${path} requires authentication`);
  }
});

test('video ICE configuration endpoint is authenticated and follows the resource list route', () => {
  const iceRoute = api.stack.find((layer) => layer.route?.path === '/video/ice-servers' && layer.route.methods.get)?.route;
  const resourcesIndex = api.stack.findIndex((layer) => layer.route?.path === '/resources');
  const iceIndex = api.stack.findIndex((layer) => layer.route?.path === '/video/ice-servers');
  const authenticateIndex = api.stack.findIndex((layer) => !layer.route);
  assert.ok(iceRoute);
  assert.ok(iceIndex > resourcesIndex);
  assert.ok(iceIndex > authenticateIndex);
  assert.equal(iceRoute.stack.length, 1);
});

test('legacy REST video signaling remains available for existing clients', () => {
  assert.ok(api.stack.some((layer) => layer.route?.path === '/video/signal' && layer.route.methods.post));
});
