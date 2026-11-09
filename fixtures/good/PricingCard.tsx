import React, { useState } from 'react';
import { CheckIcon } from 'lucide-react';
import { plans } from './mockData';

type Billing = 'monthly' | 'yearly';

export function PricingCard() {
  const [billing, setBilling] = useState<Billing>('monthly');
  const plan = plans[billing];

  return (
    <section className="mx-auto w-full max-w-sm rounded-[14px] border border-gray-200 p-6">
      <img
        className="h-10 w-10"
        src="https://example.com/assets/logo.png"
        alt="Logo"
      />
      <h2 className="mt-4 text-xl font-semibold">{plan.name}</h2>
      <p className="text-3xl font-semibold text-[var(--accent)]">{plan.price}</p>
      <ul className="mt-4 space-y-2">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-center gap-2 text-sm">
            <CheckIcon className="h-4 w-4 text-accent" />
            {feature}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-6 w-full rounded-md bg-accent px-4 py-2 text-white"
        onClick={() => setBilling(billing === 'monthly' ? 'yearly' : 'monthly')}
      >
        Switch to {billing === 'monthly' ? 'yearly' : 'monthly'} billing
      </button>
    </section>
  );
}
