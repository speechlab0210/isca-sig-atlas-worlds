import fs from 'node:fs';
export default class Report {
  tests = [];
  onTestEnd(test, result) {
    this.tests.push({ title: test.titlePath().join(' / '), status: result.status,
      errors: result.errors.map(e => e.message) });
  }
  onEnd(result) {
    fs.mkdirSync('qa-artifacts', { recursive: true });
    fs.writeFileSync('qa-artifacts/result.json', JSON.stringify({
      status: result.status, mode: process.env.QA_MODE || 'staged',
      commit: process.env.GITHUB_SHA, dataCommit: process.env.QA_DATA_COMMIT,
      runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      tests: this.tests, completedAt: new Date().toISOString()
    }, null, 2));
  }
}
