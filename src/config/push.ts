import webPush from 'web-push';
import { env } from './env';

if (env.VAPID_ENABLED) {
  webPush.setVapidDetails(
    env.VAPID_SUBJECT ?? '',
    env.VAPID_PUBLIC_KEY ?? '',
    env.VAPID_PRIVATE_KEY ?? ''
  );
}

export { webPush };
