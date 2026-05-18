import GemWalletApp from './GemWallet.jsx';
import { WalletProvider } from './context/WalletContext.jsx';

export default function App() {
  return (
    <WalletProvider>
      <GemWalletApp />
    </WalletProvider>
  );
}
