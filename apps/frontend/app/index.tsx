import { useRouter } from 'expo-router'
import { OnboardingForm } from '../src/components/OnboardingForm'
import { savePreferences } from '../src/api/client'
export default function Index() { const router = useRouter(); return <OnboardingForm submit={savePreferences} onComplete={() => router.replace('/discover')} /> }
