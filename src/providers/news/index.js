import { serpapiNewsProvider } from './serpapi.js';
import { fixtureNewsProvider } from './fixture.js';
import { resolveSerpApiKey } from '../../serpapi.js';
import { config } from '../../config.js';

export function hasSerpApiKey() {
  return Boolean(resolveSerpApiKey());
}

export function resolveNewsProvider(settings, { demoMode = config.demoMode } = {}) {
  const mode = settings?.providers?.news || 'auto';
  if (demoMode || mode === 'fixture') return fixtureNewsProvider;
  if (mode === 'serpapi') return serpapiNewsProvider;
  return hasSerpApiKey() ? serpapiNewsProvider : fixtureNewsProvider;
}

export { serpapiNewsProvider, fixtureNewsProvider };
