import { HelmetProvider } from 'react-helmet-async';
import AiLabs from './pages/AiLabs';
export default function App() {
  return (
    <HelmetProvider>
      <AiLabs />
    </HelmetProvider>
  );
}
