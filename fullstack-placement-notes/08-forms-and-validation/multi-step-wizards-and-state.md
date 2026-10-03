# Multi-Step Wizards: Phased State Persistence and Step-by-Step Validation

## 1. What is it?
A Multi-Step Wizard is an interactive UI architecture that divides long, cognitively demanding data-entry tasks (e.g. loan applications, employee onboarding, complex e-commerce checkouts) into sequential, bite-sized phases or steps. Core architectural requirements include:
- **Phased Validation:** Validating each step's specific schema before permitting the user to advance to the next step.
- **Partial State Persistence:** Safely preserving user entries across step transitions, browser refreshes, and unmounted step views (using URL query params, SessionStorage, or a dedicated Zustand store).
- **Navigation Guarding:** Preventing users from skipping ahead to Step 4 when Step 2 contains invalid or incomplete fields.
- **Master Schema Synthesis:** Consolidating all partial step schemas into an atomic, strongly-typed master submission schema.

```
+-------------------------------------------------------------------------------+
|                       MULTI-STEP WIZARD ARCHITECTURE                          |
+-------------------------------------------------------------------------------+
| Master Schema = Step1Schema.merge(Step2Schema).merge(Step3Schema)             |
|                                                                               |
| [ Step 1: Identity ] ---> Validate Step 1 Schema ---> Persist partial in Store|
|           |                                                                   |
|           v                                                                   |
| [ Step 2: Address ]  ---> Validate Step 2 Schema ---> Persist partial in Store|
|           |                                                                   |
|           v                                                                   |
| [ Step 3: Payment ]  ---> Validate Step 3 Schema ---> Persist partial in Store|
|           |                                                                   |
|           v                                                                   |
| Final Review & Submission: Validates Entire Master Schema & Calls API/Action   |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
Presenting users with a monolithic form containing 40+ inputs results in immediate cognitive overload, high bounce rates, and form abandonment:
- Users struggle to see their overall progress.
- If a form error occurs at input 38, the user gets lost trying to locate the red error banner.
- If a user accidentally closes their tab or navigates back, an un-persisted monolithic form loses all 38 filled fields.

Multi-Step Wizards solve this by organizing complex workflows into structured milestones, providing immediate feedback per milestone, and persisting entered data at each step boundary.

---

## 3. Mental Model
Think of a Multi-Step Wizard as a **Multi-Stage Rocket Launch**:
- **Stage 1 (Booster):** Lifts the rocket through the lower atmosphere (Personal Identity). Once stage 1 clears inspection and achieves orbit, the rocket locks the data and ignites Stage 2.
- **Stage 2 (Orbital Burn):** Navigates through orbital insertion (Address & Residency).
- **Stage 3 (Payload Delivery):** Executes the final docking maneuver (Payment & Terms).
- If Stage 1 ran out of fuel or failed telemetry checks, mission control aborts the launch immediately—you cannot ignite Stage 3 without a successful Stage 1 burn!

---

## 4. Basic Example

### Step Navigation State Machine
```typescript
import { useState } from 'react';

type Step = 'IDENTITY' | 'CONTACT' | 'REVIEW';

export function SimpleWizard() {
  const [currentStep, setCurrentStep] = useState<Step>('IDENTITY');
  const [formData, setFormData] = useState({ name: '', email: '' });

  const nextStep = () => {
    if (currentStep === 'IDENTITY') setCurrentStep('CONTACT');
    else if (currentStep === 'CONTACT') setCurrentStep('REVIEW');
  };

  const prevStep = () => {
    if (currentStep === 'REVIEW') setCurrentStep('CONTACT');
    else if (currentStep === 'CONTACT') setCurrentStep('IDENTITY');
  };

  return (
    <div className="p-6 max-w-md mx-auto border rounded">
      <div className="mb-4 text-sm font-bold text-gray-500">Current Phase: {currentStep}</div>

      {currentStep === 'IDENTITY' && (
        <div>
          <label>Full Name</label>
          <input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full p-2 border rounded mt-1"
          />
        </div>
      )}

      {currentStep === 'CONTACT' && (
        <div>
          <label>Work Email</label>
          <input
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full p-2 border rounded mt-1"
          />
        </div>
      )}

      {currentStep === 'REVIEW' && (
        <div>
          <p>Name: {formData.name}</p>
          <p>Email: {formData.email}</p>
        </div>
      )}

      <div className="flex justify-between mt-6">
        <button onClick={prevStep} disabled={currentStep === 'IDENTITY'} className="px-4 py-2 border rounded disabled:opacity-50">
          Back
        </button>
        <button onClick={nextStep} className="px-4 py-2 bg-blue-600 text-white rounded">
          {currentStep === 'REVIEW' ? 'Confirm & Submit' : 'Next Step'}
        </button>
      </div>
    </div>
  );
}
```

---

## 5. Real Example

### Enterprise Wizard with React Hook Form, Step-Level Zod Schemas, and Zustand Persistence
```typescript
// schemas/wizardSchemas.ts
import { z } from 'zod';

// Step 1 Schema
export const Step1Schema = z.object({
  fullName: z.string().min(2, 'Full name required'),
  jobTitle: z.string().min(2, 'Job title required'),
});

// Step 2 Schema
export const Step2Schema = z.object({
  companyEmail: z.string().email('Invalid business email format'),
  phoneNumber: z.string().min(10, 'Valid 10-digit phone number required'),
});

// Step 3 Schema
export const Step3Schema = z.object({
  billingTier: z.enum(['STARTER', 'GROWTH', 'ENTERPRISE']),
  seatsRequested: z.coerce.number().int().min(1).max(500),
});

// Master Combined Schema
export const MasterOnboardingSchema = Step1Schema.merge(Step2Schema).merge(Step3Schema);
export type OnboardingValues = z.infer<typeof MasterOnboardingSchema>;
```

```typescript
// stores/wizardStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { OnboardingValues } from '@/schemas/wizardSchemas';

interface WizardStore {
  step: number;
  data: Partial<OnboardingValues>;
  setStep: (step: number) => void;
  updateData: (partial: Partial<OnboardingValues>) => void;
  resetWizard: () => void;
}

export const useWizardStore = create<WizardStore>()(
  persist(
    (set) => ({
      step: 1,
      data: {},
      setStep: (step) => set({ step }),
      updateData: (partial) => set((s) => ({ data: { ...s.data, ...partial } })),
      resetWizard: () => set({ step: 1, data: {} }),
    }),
    { name: 'onboarding-wizard-storage' }
  )
);
```

```typescript
// components/OnboardingWizard.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useWizardStore } from '@/stores/wizardStore';
import { Step1Schema, Step2Schema, Step3Schema, OnboardingValues } from '@/schemas/wizardSchemas';

export function OnboardingWizard() {
  const { step, setStep, data, updateData, resetWizard } = useWizardStore();

  // Pick schema based on active step
  const currentSchema = step === 1 ? Step1Schema : step === 2 ? Step2Schema : Step3Schema;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(currentSchema),
    defaultValues: data,
  });

  const onStepSubmit = (stepData: any) => {
    updateData(stepData);

    if (step < 3) {
      setStep(step + 1);
    } else {
      // Final Submission
      const finalPayload = { ...data, ...stepData } as OnboardingValues;
      console.log('Transmitting final verified application:', finalPayload);
      alert('Application provisioned successfully!');
      resetWizard();
    }
  };

  return (
    <div className="max-w-lg mx-auto p-6 bg-white border rounded-xl shadow-md space-y-6">
      {/* Progress Indicator */}
      <div className="flex justify-between items-center border-b pb-4">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
              step === s ? 'bg-blue-600 text-white' : step > s ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'
            }`}>
              {step > s ? '✓' : s}
            </div>
            <span className="text-xs font-semibold">{s === 1 ? 'Profile' : s === 2 ? 'Contact' : 'Plan'}</span>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit(onStepSubmit)} className="space-y-4">
        {step === 1 && (
          <>
            <div>
              <label className="block text-sm font-medium">Full Name</label>
              <input {...register('fullName')} className="w-full p-2 border rounded mt-1" />
              {errors.fullName && <p className="text-red-500 text-xs mt-1">{errors.fullName.message as string}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium">Job Title</label>
              <input {...register('jobTitle')} className="w-full p-2 border rounded mt-1" />
              {errors.jobTitle && <p className="text-red-500 text-xs mt-1">{errors.jobTitle.message as string}</p>}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <label className="block text-sm font-medium">Business Email</label>
              <input {...register('companyEmail')} type="email" className="w-full p-2 border rounded mt-1" />
              {errors.companyEmail && <p className="text-red-500 text-xs mt-1">{errors.companyEmail.message as string}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium">Phone Number</label>
              <input {...register('phoneNumber')} className="w-full p-2 border rounded mt-1" />
              {errors.phoneNumber && <p className="text-red-500 text-xs mt-1">{errors.phoneNumber.message as string}</p>}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div>
              <label className="block text-sm font-medium">Select Tier</label>
              <select {...register('billingTier')} className="w-full p-2 border rounded mt-1 bg-white">
                <option value="STARTER">Starter Tier</option>
                <option value="GROWTH">Growth Tier</option>
                <option value="ENTERPRISE">Enterprise Tier</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Requested User Seats</label>
              <input {...register('seatsRequested')} type="number" className="w-full p-2 border rounded mt-1" />
              {errors.seatsRequested && <p className="text-red-500 text-xs mt-1">{errors.seatsRequested.message as string}</p>}
            </div>
          </>
        )}

        <div className="flex justify-between pt-4 border-t">
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            disabled={step === 1}
            className="px-4 py-2 border rounded text-sm disabled:opacity-30"
          >
            Previous
          </button>
          <button type="submit" className="px-6 py-2 bg-blue-600 text-white font-semibold rounded text-sm hover:bg-blue-700">
            {step === 3 ? 'Finalize & Submit' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

---

## 6. Under the Hood

### 1. Schema Merging vs Discrimination
When creating a multi-step form:
- Using `Step1Schema.merge(Step2Schema)` combines all property rules into an atomic master schema.
- At intermediate steps, passing `zodResolver(Step1Schema)` validates **only** the properties relevant to the active step, allowing unmounted fields for Steps 2 and 3 to remain missing without triggering validation errors.

### 2. Form Unmounting State Destruction
In React, when a component conditionally unmounts (`{step === 1 && <Step1Inputs />}`), the underlying DOM nodes and React Hook Form refs are destroyed!
- **Solution:** Always persist step values into an external store (Zustand, SessionStorage, or a top-level `useForm` instance wrapping the entire wizard) before transitioning to the next step.

---

## 7. Important Rules
1. **Never Allow Step Skipping:** Validate the current step's schema before incrementing the step counter. Never allow a user to jump directly to Step 3 by clicking navigation dots unless Steps 1 and 2 pass validation.
2. **Synchronize Step Index with the URL:** Storing the current step in the URL (e.g. `/onboarding?step=2`) allows users to refresh without losing their current location in the wizard.
3. **Persist Partial Drafts:** In high-value business forms, persist intermediate drafts to the database or localStorage so users can resume later.
4. **Final Step Must Validate Master Schema:** Before triggering the final API mutation, always run `MasterSchema.safeParse(completeData)` to guarantee that no earlier step values were corrupted or bypassed.

---

## 8. Common Mistakes

### Mistake 1: Validating Master Schema at Step 1
```typescript
// ❌ WRONG: Validating master schema at Step 1 throws errors for missing Step 2 and Step 3 fields!
const { handleSubmit } = useForm({ resolver: zodResolver(MasterSchema) });
// Result: Step 1 can never be submitted!
```
**Fix:** Use the step-specific schema for each step (`resolver: zodResolver(currentStepSchema)`).

### Mistake 2: Losing State When Navigating Backward
```typescript
// ❌ GOTCHA: User fills Step 1, moves to Step 2, clicks "Back", and Step 1 inputs are blank!
```
**Fix:** Initialize form inputs with `defaultValues: persistedStoreData`.

---

## 9. Best Practices
1. **Step-Specific Routing (`app/wizard/[step]/page.tsx`):** For massive wizards, dedicate a dynamic route per step. This enables natural browser Back button navigation and deep linking.
2. **Review Step Before Final Submission:** Always provide a dedicated "Review & Confirmation" step summarizing all entered fields before the final submit button.
3. **Clean Up Storage on Complete:** Always call `clear()` or `resetWizard()` upon successful submission to prevent old draft state from polluting subsequent user sessions.

---

## 10. Performance Considerations
- **Isolated Step Rendering:** Because only one step renders at a time, React DOM reconciliation overhead is minimal compared to a 50-field monolithic form.
- **Debounced Draft Autosave:** When persisting drafts to a remote backend API, debounce the autosave call by 1,000ms to avoid flooding backend databases.

---

## 11. Security Considerations
- **Tampered Step Skipping:** A malicious user can inspect network traffic and fire the final submission payload directly to your backend endpoint, skipping Steps 1 and 2. **Always validate the complete master schema on the backend server before executing mutations!**
- **PII Storage in LocalStorage:** If the wizard collects sensitive data (credit cards, health records), never store raw values in unencrypted `localStorage`. Store them in memory or secure session cookies.

---

## 12. Alternatives
- **Single Page Monolithic Form with Accordion:** All inputs mount simultaneously, toggling visibility via CSS. Simpler, but suffers from DOM bloat and controlled re-render lag.
- **XState Finite State Machine:** Using XState to model complex multi-branching wizard paths. Ideal for dynamic wizards where Step 2 depends conditionally on choices in Step 1.

---

## 13. Trade-offs

| Strategy | Advantages | Drawbacks |
| :--- | :--- | :--- |
| **Zustand + Step Schemas**| Fast; persists across tabs; clean separation | Requires managing external store |
| **Single RHF Root Form** | Zero external state libraries needed | High memory usage; unmounting input management |
| **URL-Driven Steps (`/[step]`)**| Native back button; shareable steps | Requires route setup and serialization |

---

## 14. Real-World Usage
- **TurboTax / Tax Filing Systems:** Dozens of sequential phases validating financial figures step-by-step with continuous draft persistence.
- **AWS / GCP Cloud Resource Provisioning:** Multi-tier infrastructure creation wizards (1. Select AMI, 2. Instance Type, 3. Storage, 4. Security Groups, 5. Review & Launch).

---

## 15. Placement Interview Questions

### Basic
**Q: What is the primary architectural challenge when implementing a multi-step form in React?**  
*Answer:* The primary challenge is state persistence and partial validation. Because step components unmount when moving between steps, their local DOM state is destroyed. The application must persist entered values into an external store (Zustand, React Context, or SessionStorage) and validate only the current step's fields before allowing the user to proceed.

### Conceptual
**Q: How do you design Zod schemas for a multi-step wizard to validate step-by-step while maintaining an atomic final schema?**  
*Answer:* Define an independent Zod schema for each step (e.g. `Step1Schema`, `Step2Schema`, `Step3Schema`). For each step component, pass the corresponding step schema to the validation resolver. At the top level, merge all schemas using `Step1Schema.merge(Step2Schema).merge(Step3Schema)` to generate the master schema for final verification.

### Implementation
**Q: How do you prevent a user from navigating backward and losing previously entered data in React Hook Form?**  
*Answer:* Pass the persisted store data into the form's `defaultValues` configuration:
```typescript
const { register } = useForm({
  defaultValues: storedWizardData, // Pre-populates inputs from persistent store
});
```

### Debugging
**Q: In a multi-step form, clicking "Next" triggers validation errors for fields that belong to Step 2 while the user is still on Step 1. Why?**  
*Answer:* The form resolver was configured with the complete `MasterSchema` instead of the step-specific `Step1Schema`. Because Step 2 fields are not yet rendered, they are missing from the form data, causing the master schema validation to fail.

### Scenario
**Q: You need to implement a dynamic wizard where selecting "Business Account" on Step 1 inserts an additional "Company Details" step between Step 1 and Step 2. How do you design the state machine?**  
*Answer:* Model the steps as an array of step identifiers derived dynamically from current form state:
```typescript
const steps = ['ACCOUNT_TYPE', ...(accountType === 'BUSINESS' ? ['COMPANY_DETAILS'] : []), 'PAYMENT', 'CONFIRM'];
const currentStepName = steps[currentStepIndex];
```

### Advanced
**Q: How do you secure multi-step wizard submissions against API bypass attacks on the backend?**  
*Answer:* Never trust the client's assertion that prior steps were completed. On the backend, either:
1. Maintain a server-side session/draft in the database tracking completed steps.
2. Require the final submission endpoint to validate the full, combined master schema with all required fields present before processing.

---

## 16. Coding Questions

### Problem: Implement a Step Progress Bar Component with Clickable Traversal Guards
```typescript
// components/WizardStepper.tsx
interface StepperProps {
  steps: string[];
  currentStep: number;
  completedSteps: number[];
  onStepClick: (stepIndex: number) => void;
}

export function WizardStepper({ steps, currentStep, completedSteps, onStepClick }: StepperProps) {
  return (
    <nav className="flex items-center justify-between w-full mb-8">
      {steps.map((label, index) => {
        const stepNum = index + 1;
        const isCurrent = currentStep === stepNum;
        const isCompleted = completedSteps.includes(stepNum);
        const canClick = isCompleted || isCurrent;

        return (
          <div key={label} className="flex-1 flex flex-col items-center relative">
            {/* Step Circle */}
            <button
              type="button"
              disabled={!canClick}
              onClick={() => onStepClick(stepNum)}
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all z-10 ${
                isCurrent
                  ? 'bg-blue-600 text-white ring-4 ring-blue-100 shadow-md'
                  : isCompleted
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isCompleted ? '✓' : stepNum}
            </button>

            {/* Step Title */}
            <span className={`text-xs mt-2 font-medium ${isCurrent ? 'text-blue-600 font-bold' : 'text-gray-500'}`}>
              {label}
            </span>
          </div>
        );
      })}
    </nav>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "You must keep all step inputs mounted in the DOM using `display: none` to preserve state."  
  *Truth:* False. Keeping all inputs mounted bloats the DOM tree and causes performance issues. Unmount steps cleanly and persist state in an external store (Zustand / SessionStorage).
- **Trap 2:** "Client-side step validation is sufficient to prevent incomplete account creation."  
  *Truth:* False. Malicious users can send HTTP requests directly to the final endpoint; backend validation of the master schema is mandatory.

---

## 18. Revision Summary
- Multi-step wizards break complex forms into digestible phases to prevent user cognitive overload.
- Validate step-by-step using modular Zod schemas (`Step1Schema`, `Step2Schema`).
- Merge step schemas into an atomic `MasterSchema` for final verification.
- Persist partial form data in an external store (Zustand with `persist`) to survive step unmounting and browser reloads.
- Guard against step skipping both on the frontend and backend.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| Wizard Requirement                | Implementation Pattern                    |
+------------------------------------+-------------------------------------------+
| Step-by-step schema validation     | zodResolver(currentStepSchema)            |
| Final atomic submission schema     | Step1Schema.merge(Step2Schema).merge(...) |
| Partial state persistence          | Zustand store with persist middleware     |
| Step unmounting protection         | Pass persisted data into defaultValues    |
| Preventing step skipping           | Guard step transitions with form.trigger()|
| Deep linking & browser back button | Synchronize step index with URL ?step=N   |
+------------------------------------+-------------------------------------------+
```
