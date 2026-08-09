import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider } from "connectkit";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { wagmiConfig } from "./config/wagmi";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Inbox from "./pages/Inbox";
import CreateLink from "./pages/CreateLink";
import LinkDetail from "./pages/LinkDetail";

const queryClient = new QueryClient();

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          theme="midnight"
          customTheme={{
            "--ck-accent-color": "#00e5ff",
            "--ck-accent-text-color": "#09090b",
            "--ck-body-background": "#0f0f12",
            "--ck-border-radius": "20px",
          }}
        >
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="inbox" element={<Inbox />} />
                <Route path="create" element={<CreateLink />} />
                <Route path="links/:id" element={<LinkDetail />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
