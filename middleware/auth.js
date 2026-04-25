import { readJSON } from '../helpers/json.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERS_PATH = join(__dirname, '..', 'server-data', 'users.json');

export function requireAuth(req, res, next) {
  const user = req.user || req.session?.user;
  if (!user) {
    return res.status(401).json({ error: 'No autenticat' });
  }
  req.user = user;
  const users = readJSON(USERS_PATH);
  const userItem = users.itemListElement.find(
    el => el.item.identifier === user.id
  );
  if (!userItem) {
    return res.status(401).json({ error: 'Usuari no trobat' });
  }
  req.userProfile = userItem.item;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.user || req.session?.user;
    if (!user) {
      return res.status(401).json({ error: 'No autenticat' });
    }
    req.user = user;
    const users = readJSON(USERS_PATH);
    const userItem = users.itemListElement.find(
      el => el.item.identifier === user.id
    );
    if (!userItem || !roles.includes(userItem.item.jobTitle)) {
      return res.status(403).json({ error: 'No autoritzat' });
    }
    req.userProfile = userItem.item;
    next();
  };
}
