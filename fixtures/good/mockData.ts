export interface Plan {
  name: string;
  price: string;
  features: string[];
}

export const plans: Record<'monthly' | 'yearly', Plan> = {
  monthly: { name: 'Team', price: '$24 / month', features: ['Unlimited designs', 'Shared libraries'] },
  yearly: { name: 'Team', price: '$240 / year', features: ['Unlimited designs', 'Shared libraries', 'Priority support'] },
};
