import { demoInsights } from "@/demo-data/insights";

export function FunnelTeaser() {
  const { funnel } = demoInsights;
  const steps = [
    { label: "Discovered", value: funnel.discovered },
    { label: "Passed the title filter", value: funnel.passedFilter },
    { label: "Eligible by location and role", value: funnel.eligible },
    { label: "Read and scored", value: funnel.analysed }
  ];
  return (
    <ol className="space-y-3" aria-label="Example run: from discovered jobs to scored jobs">
      {steps.map((step) => (
        <li key={step.label}>
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">{step.label}</span>
            <span className="tabular text-muted-foreground">{step.value}</span>
          </div>
          <div className="mt-1.5 h-3 rounded-sm bg-muted">
            <div className="h-full rounded-sm bg-primary" style={{ width: `${Math.max(3, (step.value / funnel.discovered) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
