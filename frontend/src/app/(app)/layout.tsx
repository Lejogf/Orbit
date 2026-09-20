import { Nav } from '@/components/Nav';
import { AuthGuard } from '@/components/AuthGuard';
import { ToastProvider } from '@/components/Toast';

// Shared chrome for every signed-in screen.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AuthGuard>
        <div className="min-h-screen">
          <Nav />
          {/* Left padding clears the desktop sidebar; bottom clears the mobile tabs. */}
          <main className="px-4 pb-28 pt-5 sm:px-6 lg:pb-10 lg:pl-[16.5rem] lg:pr-8 lg:pt-10">
            <div className="mx-auto w-full max-w-5xl">{children}</div>
          </main>
        </div>
      </AuthGuard>
    </ToastProvider>
  );
}
