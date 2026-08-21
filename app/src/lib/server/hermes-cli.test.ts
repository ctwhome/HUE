import { expect, test } from 'bun:test';
import { parseCronJobs, parseProfiles, parseSkills } from './hermes-cli';

test('parses installed skills from Hermes CLI output', () => {
	expect(
		parseSkills(`
│ Name          │ Category │ Source  │ Trust   │ Status  │
│ browser-use   │          │ local   │ local   │ enabled │
│ computer-use  │ apple    │ builtin │ builtin │ enabled │
15 hub-installed, 81 builtin — 2 enabled shown`)
	).toEqual([
		{ name: 'browser-use', category: '', source: 'local', trust: 'local', status: 'enabled' },
		{
			name: 'computer-use',
			category: 'apple',
			source: 'builtin',
			trust: 'builtin',
			status: 'enabled'
		}
	]);
});

test('parses scheduled jobs from Hermes CLI output', () => {
	expect(
		parseCronJobs(`
  b5a9c19073c8 [active]
    Name:      Monthly check
    Schedule:  0 9 1 * *
    Next run:  2026-09-01T09:00:00+02:00

  87ff409f1776 [paused]
    Name:      Daily application
    Schedule:  30 8 * * *`)
	).toEqual([
		{
			id: 'b5a9c19073c8',
			status: 'active',
			name: 'Monthly check',
			schedule: '0 9 1 * *',
			nextRun: '2026-09-01T09:00:00+02:00'
		},
		{
			id: '87ff409f1776',
			status: 'paused',
			name: 'Daily application',
			schedule: '30 8 * * *'
		}
	]);
});

test('parses Hermes profiles and active state', () => {
	expect(
		parseProfiles(`
 Profile          Model                        Gateway      Alias        Distribution
 ◆default         gpt-5.6-sol                  running      —            —
  lady-danbury    gpt-5.6-sol                  running      —            —`)
	).toEqual([
		{ name: 'default', model: 'gpt-5.6-sol', gateway: 'running', active: true },
		{ name: 'lady-danbury', model: 'gpt-5.6-sol', gateway: 'running', active: false }
	]);
});
