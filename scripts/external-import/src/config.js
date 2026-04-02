import 'dotenv/config';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function parseServiceAccountJson(rawValue) {
  if (!rawValue) return null;

  const parsed = JSON.parse(rawValue);
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

function buildFirebaseOptions(projectId, serviceAccount) {
  const options = {};

  if (serviceAccount) {
    options.credential = cert(serviceAccount);
    options.projectId = projectId || serviceAccount.project_id;
    return options;
  }

  options.credential = applicationDefault();
  if (projectId) {
    options.projectId = projectId;
  }
  return options;
}

export function getProjectId() {
  return process.env.FIREBASE_PROJECT_ID?.trim() || '';
}

export function initializeFirestoreContext({ requireCredentials = false, logger } = {}) {
  const projectId = getProjectId();
  const serviceAccount = parseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const canUseDefaultCredentials = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS) || requireCredentials;

  if (!serviceAccount && !canUseDefaultCredentials) {
    logger?.debug('Firestore admin context skipped because no credentials were provided.');
    return null;
  }

  try {
    const options = buildFirebaseOptions(projectId, serviceAccount);
    const app = getApps()[0] || initializeApp(options);
    return getFirestore(app);
  } catch (error) {
    if (requireCredentials) {
      throw error;
    }

    logger?.warn(`Firestore admin context unavailable: ${error.message}`);
    return null;
  }
}
