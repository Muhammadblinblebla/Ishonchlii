import { z } from 'zod';

/**
 * Parol talablari (§11): minimal 8 belgi.
 *
 * Yuqori chegara ham bor: argon2 juda uzun matnni hashlashga ancha vaqt
 * sarflaydi, ya'ni cheklovsiz uzunlik DoS vositasiga aylanadi.
 */
const password = z
  .string()
  .min(8, 'Parol kamida 8 belgidan iborat bo\'lishi kerak')
  .max(200, 'Parol juda uzun');

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email manzil noto\'g\'ri')
  .max(254);

/** O'zbekiston raqami: +998 XX XXX XX XX */
const phone = z
  .string()
  .trim()
  .regex(/^\+998\d{9}$/, 'Telefon raqam +998XXXXXXXXX ko\'rinishida bo\'lishi kerak');

export const registerSchema = z.object({
  email,
  password,
  fullName: z.string().trim().min(2, 'Ism kamida 2 belgi').max(120),
  phone: phone.optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Parol kiritilmagan').max(200),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token kiritilmagan'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
