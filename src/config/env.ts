import { z } from 'zod';

const booleanFromString = z
  .string()
  .optional()
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  FRONTEND_ORIGIN: z.string().url(),
  FRONTEND_ORIGINS: z.string().optional(),
  COOKIE_SECRET: z.string().min(32),
  SESION_NOMBRE_COOKIE: z.string().min(1).default('sid_5s'),
  SESION_DIAS_INACTIVIDAD: z.coerce.number().int().positive().default(180),
  SESION_RENOVAR_CADA_HORAS: z.coerce.number().int().positive().default(8),
  PROXY_CONFIANZA: z.enum(['false', 'loopback']).default('false'),
  CLOUDINARY_ENABLED: booleanFromString.default(false),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  VAPID_ENABLED: booleanFromString.default(false),
  VAPID_SUBJECT: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  SMTP_ENABLED: booleanFromString.default(false),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanFromString.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  WHATSAPP_ENABLED: booleanFromString.default(false),
  NOTIFICACIONES_WORKER_ENABLED: booleanFromString.default(true),
  NOTIFICACIONES_WORKER_CRON: z.string().default('*/1 * * * *'),
  INVITADO_PUBLICO_ENABLED: booleanFromString.default(false),
  INVITADO_PUBLICO_SECRET: z.string().optional(),
  INVITADO_PUBLICO_EXPIRA_HORAS: z.coerce.number().int().positive().default(6),
});

const validarServicio = (
  enabled: boolean,
  variables: Array<[string, string | undefined]>,
  issues: string[]
) => {
  if (!enabled) return;
  for (const [nombre, valor] of variables) {
    if (!valor) issues.push(`${nombre} es requerida cuando el servicio esta habilitado`);
  }
};

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Environment validation failed:');
  parsed.error.issues.forEach((issue) => {
    console.error(`- Variable: ${issue.path.join('.')}. Error: ${issue.message}`);
  });
  process.exit(1);
}

const issues: string[] = [];

validarServicio(
  parsed.data.CLOUDINARY_ENABLED,
  [
    ['CLOUDINARY_CLOUD_NAME', parsed.data.CLOUDINARY_CLOUD_NAME],
    ['CLOUDINARY_API_KEY', parsed.data.CLOUDINARY_API_KEY],
    ['CLOUDINARY_API_SECRET', parsed.data.CLOUDINARY_API_SECRET],
  ],
  issues
);

validarServicio(
  parsed.data.VAPID_ENABLED,
  [
    ['VAPID_SUBJECT', parsed.data.VAPID_SUBJECT],
    ['VAPID_PUBLIC_KEY', parsed.data.VAPID_PUBLIC_KEY],
    ['VAPID_PRIVATE_KEY', parsed.data.VAPID_PRIVATE_KEY],
  ],
  issues
);

validarServicio(
  parsed.data.SMTP_ENABLED,
  [
    ['SMTP_HOST', parsed.data.SMTP_HOST],
    ['SMTP_USER', parsed.data.SMTP_USER],
    ['SMTP_PASS', parsed.data.SMTP_PASS],
    ['SMTP_FROM', parsed.data.SMTP_FROM],
  ],
  issues
);

if (parsed.data.INVITADO_PUBLICO_ENABLED) {
  if (!parsed.data.INVITADO_PUBLICO_SECRET) {
    issues.push('INVITADO_PUBLICO_SECRET es requerida cuando INVITADO_PUBLICO_ENABLED=true');
  } else if (Buffer.byteLength(parsed.data.INVITADO_PUBLICO_SECRET, 'utf8') < 32) {
    issues.push('INVITADO_PUBLICO_SECRET debe tener al menos 32 bytes');
  }
}

if (issues.length) {
  console.error('❌ Environment validation failed:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

export const env = parsed.data;
export const frontendOriginsPermitidos = Array.from(new Set([
  parsed.data.FRONTEND_ORIGIN,
  ...(parsed.data.FRONTEND_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]));
export type Env = z.infer<typeof envSchema>;
