import { describe, expect, it } from 'vitest';
import { httpUrlOrNull, rejectRequest } from '../src/core/request-guard.ts';

const local = { host: 'localhost:4000' };

describe('rejectRequest', () => {
  it('accepte les lectures locales, refuse un Host étranger (DNS rebinding)', () => {
    expect(rejectRequest({ ...local, method: 'GET' })).toBeNull();
    expect(rejectRequest({ host: '127.0.0.1:4000', method: 'GET' })).toBeNull();
    expect(rejectRequest({ host: '[::1]:4000', method: 'GET' })).toBeNull();
    expect(rejectRequest({ host: 'evil.example:4000', method: 'GET' })).toBe('Hôte non autorisé');
    expect(rejectRequest({ host: '192.168.1.180:4000', method: 'GET' })).toBe('Hôte non autorisé');
    expect(rejectRequest({ method: 'GET' })).toBe('Hôte non autorisé');
  });

  it('modifications : JSON de la même origine, ou sans Origin (outils en ligne de commande)', () => {
    const json = 'application/json';
    expect(rejectRequest({ ...local, method: 'POST', origin: 'http://localhost:4000', contentType: json })).toBeNull();
    expect(rejectRequest({ ...local, method: 'PATCH', contentType: `${json}; charset=utf-8` })).toBeNull();
    expect(rejectRequest({ ...local, method: 'DELETE', origin: 'http://localhost:4000' })).toBeNull();
  });

  it('refuse les requêtes forgées par un site tiers (CSRF)', () => {
    expect(rejectRequest({ ...local, method: 'POST', origin: 'https://evil.example', contentType: 'application/json' })).toBe('Origine non autorisée');
    expect(rejectRequest({ ...local, method: 'DELETE', origin: 'https://evil.example' })).toBe('Origine non autorisée');
    expect(rejectRequest({ ...local, method: 'POST', contentType: 'application/x-www-form-urlencoded' })).toBe('Corps JSON attendu');
    expect(rejectRequest({ ...local, method: 'POST', contentType: 'text/plain' })).toBe('Corps JSON attendu');
    expect(rejectRequest({ ...local, method: 'POST', origin: 'null', contentType: 'application/json' })).toBe('Origine invalide');
  });
});

describe('httpUrlOrNull', () => {
  it('ne garde que les liens http(s)', () => {
    expect(httpUrlOrNull('https://wpscan.com/v/1')).toBe('https://wpscan.com/v/1');
    expect(httpUrlOrNull('javascript:alert(1)')).toBeNull();
    expect(httpUrlOrNull(' javascript:alert(1)')).toBeNull();
    expect(httpUrlOrNull('data:text/html,x')).toBeNull();
    expect(httpUrlOrNull(undefined)).toBeNull();
  });
});
