import fs from 'node:fs';
import path from 'node:path';

// Seed a separate preview installation once; never replace its own settings.
export const seedImageSettings = (installationRoot, stateRoot) => {
  const source = path.join(installationRoot, 'runtime/image-settings.json');
  const destination = path.join(stateRoot, 'runtime/image-settings.json');
  if (source === destination || fs.existsSync(destination) || !fs.existsSync(source)) return false;
  const contents = fs.readFileSync(source, 'utf8');
  const settings = JSON.parse(contents);
  if (!settings.configurations?.some(entry => entry.id === settings.defaultId && entry.groupKey)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.writeFileSync(destination, contents, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  return true;
};
