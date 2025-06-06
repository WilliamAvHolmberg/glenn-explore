import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/auth-context';
import { useToast } from '../../../shared/components/ui/use-toast';

interface AuthGuardProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function AuthGuard({ children, requireAdmin }: AuthGuardProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const { toast } = useToast();

  // Don't redirect while checking auth status
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-black" />
      </div>
    );
  }

  if (!isAuthenticated) {
    toast({
      title: "Authentication required",
      description: "Please sign in to access this page",
      variant: "destructive",
    });



    // Save the attempted URL for redirecting after login
    return <Navigate to="/studio/login" state={{ from: location }} replace />;
  }

  if (requireAdmin && !user?.isAdmin) {
    return <Navigate to="/studio/" state={{ from: location }} replace />;
  }

  return <>{children}</>;
} 