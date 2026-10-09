import { twelveDataProvider } from './twelveData.js';
import { fixtureProvider } from './fixture.js';
import { hasSecret, getSecretValue } from '../../secrets.js';
import { config } from '../../config.js';

export function getTwelveDataKey() {
  return getSecretValue('twelvedata_api_key') || process.env.TWELVEDATA_API_KEY || null;
}

export function hasTwelveDataKey() {
  return hasSecret('twelvedata_api_key') || Boolean(process.env.TWELVEDATA_API_KEY);
}

export function resolveMarketProvider(settings, { demoMode = config.demoMode } = {}) {
  const mode = settings?.providers?.market || 'auto';
  if (demoMode || mode === 'fixture') return fixtureProvider;
  if (mode === 'twelvedata') return twelveDataProvider;
  return hasTwelveDataKey() ? twelveDataProvider : fixtureProvider;
}

export { twelveDataProvider, fixtureProvider };
