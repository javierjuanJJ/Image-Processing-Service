import { z } from 'zod'

export const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, 'password must be at least 8 characters')
})

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1)
})

export const validateRegister = (data) => registerSchema.parse(data)
export const validatePartialRegister = (data) => registerSchema.partial().parse(data)
export const validateLogin = (data) => loginSchema.parse(data)
export const validatePartialLogin = (data) => loginSchema.partial().parse(data)
