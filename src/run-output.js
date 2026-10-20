// Saving a run's outputs without destroying the previous good results.
//
// If jobs were analysed but every analysis failed (for example Ollama was not
// running), writing `[]` would silently replace the last useful
// job-results.json. In that case nothing is written and the caller reports a
// failed run. A run that analysed nothing writes nothing either.
export const RUN_OUTPUT_PATHS = {
  results: "./data/job-results.json",
  debugProfiles: "./data/debug-job-profiles.json"
};

export async function saveRunOutputs({
  results = [],
  debugJobProfiles = [],
  attempted = 0,
  writeFile,
  paths = RUN_OUTPUT_PATHS
}) {
  if (attempted === 0) {
    return { written: false, reason: "nothing-analyzed" };
  }
  if (results.length === 0) {
    return { written: false, reason: "every-analysis-failed" };
  }

  await writeFile(paths.debugProfiles, JSON.stringify(debugJobProfiles, null, 2), "utf-8");
  await writeFile(paths.results, JSON.stringify(results, null, 2), "utf-8");
  return { written: true, reason: results.length < attempted ? "partial" : "complete" };
}
