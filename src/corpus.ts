/**
 * Corpus + rubric (methodology #130, steps 1–2).
 *
 * An audit measures the client's OWN quality bar, so the corpus is a
 * first-class, frozen, content-addressed artifact: the task families, the
 * client's practitioner-defined rubric, and the human-confirmed labels that both
 * define ground truth and calibrate the judge. Freezing (content-addressing)
 * makes the whole audit reproducible (#130 "frozen corpus + frozen panel").
 */

import { contentHash } from "./canonical.js";
import type { Corpus as PanelCorpus, GroundTruth, Task } from "./harness.js";

/** One human-labeled output for a task: the ground-truth + calibration anchor. */
export interface LabeledExample {
  output: string;
  /** Whether a practitioner judged this output acceptable against the rubric. */
  accept: boolean;
}

export interface CorpusTask extends Task {
  /** Human labels for representative outputs; the audit's ground truth. */
  labels: LabeledExample[];
}

/** The client's quality bar, captured (not invented). */
export interface Rubric {
  id: string;
  version: string;
  /** Plain-language acceptance criteria the labels were applied against. */
  criteria: string[];
}

export interface CorpusSpec {
  rubric: Rubric;
  tasks: CorpusTask[];
}

export interface FrozenCorpus extends CorpusSpec {
  /** Content hash over the rubric + tasks + labels; the reproducibility key. */
  contentHash: string;
}

/** Freeze a corpus: validate it is non-empty and content-address it. */
export function freezeCorpus(spec: CorpusSpec): FrozenCorpus {
  if (spec.tasks.length === 0) throw new Error("corpus has no tasks");
  for (const task of spec.tasks) {
    if (task.labels.length === 0) throw new Error(`task ${task.taskId} has no labels (no ground truth)`);
  }
  // Hash over a key-stable projection so label/task ordering does not change the id.
  const projection = {
    rubric: spec.rubric,
    tasks: spec.tasks
      .map((t) => ({ taskId: t.taskId, family: t.family, input: t.input, labels: [...t.labels].sort((a, b) => (a.output < b.output ? -1 : 1)) }))
      .sort((a, b) => (a.taskId < b.taskId ? -1 : 1)),
  };
  return { ...spec, contentHash: contentHash(projection) };
}

/** The panel corpus (tasks only) the harness runs the gateway over. */
export function panelCorpus(corpus: CorpusSpec): PanelCorpus {
  return { tasks: corpus.tasks.map(({ taskId, family, input }) => ({ taskId, family, input })) };
}

/**
 * Ground truth derived from the human labels: an output is acceptable iff a
 * practitioner labeled that exact output acceptable. Unlabeled outputs are
 * conservatively treated as not-accepted (they were never confirmed good).
 */
export function groundTruthFrom(corpus: CorpusSpec): GroundTruth {
  const byTask = new Map<string, Map<string, boolean>>();
  for (const task of corpus.tasks) {
    const labels = new Map<string, boolean>();
    for (const l of task.labels) labels.set(l.output, l.accept);
    byTask.set(task.taskId, labels);
  }
  return { accept: (taskId, output) => byTask.get(taskId)?.get(output) ?? false };
}
