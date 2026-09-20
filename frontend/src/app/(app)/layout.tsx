import { MobileTabs, MobileTopBar, NavMemoryBoundary, Sidebar } from '@/components/Nav';
import { AuthGuard } from '@/components/AuthGuard';
import { ToastProvider } from '@/components/Toast';
import { OriAssistant } from '@/components/ori/OriAssistant';
import { Tour } from '@/components/Tour';
import { IdleGuard } from '@/components/IdleGuard';
import { QuickDisplay } from '@/components/QuickDisplay';
import { AccountSync } from '@/components/AccountSync';

// Shared chrome for every signed-in screen.
//
// Desktop is a two-column grid: the sidebar is a column, never an overlay, so
// enlarging the text can't make it cover the page.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AuthGuard>
        <AccountSync />
        <NavMemoryBoundary />
        <div className="flex min-h-screen">
          <Sidebar />

          <div className="flex min-w-0 flex-1 flex-col">
            <MobileTopBar />

            {/* Display settings sit in a fixed pixel position, so they stay put
                when text size changes instead of sliding away from the cursor. */}
            <div style={{ padding: 20 }}
              className="pointer-events-none fixed right-0 top-0 z-30 hidden lg:block">
              <div className="pointer-events-auto">
                <QuickDisplay />
              </div>
            </div>

            {/* Bottom padding clears the mobile tab bar and the Ori button. */}
            <main id="main" tabIndex={-1} className="flex-1 px-4 pb-36 pt-5 outline-none sm:px-6 lg:px-10 lg:pb-28 lg:pt-20">
              <div className="mx-auto w-full max-w-5xl">{children}</div>
            </main>
          </div>
        </div>

        <MobileTabs />
        <OriAssistant />
        <Tour />
        <IdleGuard />
      </AuthGuard>
    </ToastProvider>
  );
}
