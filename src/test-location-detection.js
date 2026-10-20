import assert from "node:assert/strict";
import { detectLocationType } from "./build-job-profile.js";

const tests = [
  {
    name: "Explicit onsite",
    job: { location: "Valencia", description: "On-site in Valencia" },
    expected: "onsite"
  },
  {
    name: "Remote Europe",
    job: { location: "Europe", description: "Fully remote, Europe" },
    expected: "remote"
  },
  {
    name: "Hybrid office days",
    job: { location: "Valencia", description: "Hybrid, 3 days in the office" },
    expected: "hybrid"
  },
  {
    name: "City only",
    job: { location: "Valencia", description: "Frontend developer wanted" },
    expected: "unknown"
  },
  {
    name: "Conflicting location wording",
    job: { location: "Valencia", description: "Hybrid or fully remote" },
    expected: "unknown"
  },
    {
    name: "Not fully remote",
    job: {
      location: "Valencia",
      description: "This is not a fully remote position."
    },
    expected: "unknown"
  },
  {
    name: "Hybrid with office days",
    job: {
      location: "Valencia",
      description: "3 days in the office, 2 days remote."
    },
    expected: "hybrid"
  },
  {
    name: "Remote within Spain",
    job: {
      location: "Spain",
      description: "Remote within Spain only."
    },
    expected: "remote"
  },
  {
    name: "On-site or hybrid",
    job: {
      location: "Valencia",
      description: "On-site or hybrid, depending on the candidate."
    },
    expected: "unknown"
  } ,

  {
    name: "Remote with occasional office visits",
    job: {
      title: "Frontend Developer",
      location: "Valencia",
      description: "Remote work with occasional visits to the office."
    },
    expected: "unknown"
  },
  {
    name: "Hybrid schedule in Spanish",
    job: {
      title: "Desarrollador Frontend",
      location: "Valencia",
      description: "Dos días en la oficina y tres días de trabajo remoto."
    },
    expected: "hybrid"
  },
  {
    name: "Remote with location restriction",
    job: {
      title: "Frontend Developer",
      location: "Spain",
      description: "Fully remote, applicants must reside in Spain."
    },
    expected: "remote"
  },
  {
    name: "Office location without work mode",
    job: {
      title: "Frontend Developer",
      location: "Valencia office",
      description: "React and TypeScript experience required."
    },
    expected: "unknown"
  },
  {
    name: "Remote Sensing false positive prevented",
    job: {
      title: "Remote Sensing Engineer",
      location: "Valencia",
      description: "Frontend development with React and TypeScript."
    },
    expected: "unknown"
  },
  {
    name: "Remote Sensing genuine remote preserved",
    job: {
      title: "Remote Sensing Engineer (Remote)",
      location: "Spain",
      description: "Frontend development with React and TypeScript."
    },
    expected: "remote"
  },
  {
    name: "Remote Sensing genuine hybrid preserved",
    job: {
      title: "Remote Sensing Engineer",
      location: "Valencia",
      description: "Hybrid schedule with 2 days remote and 3 days in office."
    },
    expected: "hybrid"
  }

];

for (const test of tests) {
  const actual = detectLocationType(test.job);

  assert.equal(
    actual,
    test.expected,
    `${test.name}: expected ${test.expected}, received ${actual}`
  );

  console.log(`PASS: ${test.name}`);
}

console.log(`\nAll ${tests.length} location tests passed.`);