"use client";

import { useState } from "react";

interface WizardShellProps<S extends string> {
  /** Ordered step names shown as tabs (the new-site page picks them per template). */
  steps: readonly S[];
  children: (props: {
    currentStep: number;
    stepName: S;
    goNext: () => void;
    goBack: () => void;
    goToStep: (step: number) => void;
  }) => React.ReactNode;
}

export function WizardShell<S extends string>({ steps, children }: WizardShellProps<S>): React.ReactElement {
  const [currentStep, setCurrentStep] = useState(0);

  function goNext(): void {
    setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  }

  function goBack(): void {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }

  function goToStep(step: number): void {
    if (step >= 0 && step < steps.length) {
      setCurrentStep(step);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Step tabs */}
      <div className="flex gap-1 border-b border-[var(--border-secondary)] mb-6">
        {steps.map((step, i) => (
          <button
            key={step}
            onClick={(): void => {
              if (i < currentStep) goToStep(i);
            }}
            disabled={i > currentStep}
            className={`px-4 py-2.5 text-sm font-semibold transition-colors relative ${
              i === currentStep
                ? "text-cyan"
                : i < currentStep
                  ? "text-green-400 cursor-pointer"
                  : "text-[var(--text-muted)] cursor-not-allowed"
            }`}
          >
            {step}
            {i === currentStep && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Step content */}
      {children({
        currentStep,
        stepName: steps[currentStep]!,
        goNext,
        goBack,
        goToStep,
      })}
    </div>
  );
}
