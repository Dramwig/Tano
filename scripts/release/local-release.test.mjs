import { describe, expect, it } from 'vitest';
import { releaseIdentity, validateEvidence, sha256 } from './local-release.mjs';
const identity = releaseIdentity('1.2.3', 'a'.repeat(40));
const evidence = { sourceCommit: identity.sourceCommit, commands: ['npm run check', 'npm run test:native', 'npm run mcp:smoke'].map(command => ({ command, exitCode: 0 })) };
describe('Local release boundaries', () => {
  it('uses Core-tagged Local assets independently of Product update feeds', () => {
    expect(identity.base).toBe('https://github.com/Dramwig/Tano/releases/download/core-v1.2.3/');
    expect(identity.installer).toBe('Tano-Local_1.2.3_x64-setup.exe');
    for (const version of ['1.2.3-beta', '01.2.3', 'v1.2.3', '../1.2.3']) expect(() => releaseIdentity(version, identity.sourceCommit)).toThrow();
    expect(() => releaseIdentity('1.2.3', 'a'.repeat(7))).toThrow();
  });
  it('rejects stale and failed local validation before packaging', () => {
    expect(() => validateEvidence(evidence, identity)).not.toThrow();
    expect(() => validateEvidence({ ...evidence, sourceCommit: 'b'.repeat(40) }, identity)).toThrow();
    for (let i = 0; i < evidence.commands.length; i++) {
      const commands = evidence.commands.map((item, index) => ({ ...item, exitCode: index === i ? 1 : 0 }));
      expect(() => validateEvidence({ ...evidence, commands }, identity)).toThrow();
    }
  });
  it('requires acceptance of the exact signed bytes before publication', () => {
    const digest = sha256(Buffer.from('installer'));
    const acceptance = Object.fromEntries(['cleanWindowsInstall', 'launch', 'localWorkspace', 'mcp', 'productCoexistence', 'uninstallPreservesWorkspace', 'noAutomaticUpdater'].map(check => [check, true]));
    const accepted = { ...evidence, installerSha256: digest, acceptance };
    expect(() => validateEvidence(accepted, identity, digest)).not.toThrow();
    expect(() => validateEvidence(accepted, identity, 'b'.repeat(64))).toThrow();
    for (const check of Object.keys(acceptance)) expect(() => validateEvidence({ ...accepted, acceptance: { ...acceptance, [check]: false } }, identity, digest)).toThrow(check);
  });
  it('requires real Windows installer acceptance for an explicitly unsigned preview', () => {
    const digest = sha256(Buffer.from('preview'));
    const acceptance = Object.fromEntries(['windowsInstall', 'launch', 'localWorkspace', 'mcp', 'productCoexistence', 'uninstallPreservesWorkspace', 'noAutomaticUpdater'].map(check => [check, true]));
    const accepted = { ...evidence, installerSha256: digest, acceptance };
    expect(() => validateEvidence(accepted, identity, digest, true)).not.toThrow();
    expect(() => validateEvidence(accepted, identity, digest)).toThrow('cleanWindowsInstall');
    expect(() => validateEvidence({ ...accepted, acceptance: { ...acceptance, windowsInstall: false } }, identity, digest, true)).toThrow('windowsInstall');
  });
});
