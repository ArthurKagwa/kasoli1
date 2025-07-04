'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useRouter } from 'next/navigation';
import { Role, useRole } from '@/lib/hooks/useRole';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { User, ChevronDown } from 'lucide-react';

export function RoleSwitcher() {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const { address } = useAccount();
  const { role, refetch } = useRole();
  const router = useRouter();

  // Check if current user is platform account
  const platformAddress = process.env.NEXT_PUBLIC_PLATFORM_ADDRESS || '';
  const isPlatformAccount = address && platformAddress && address.toLowerCase() === platformAddress.toLowerCase();

  const switchRole = async (r: Role) => {
    if (!address || !r || switching) return;
    
    setSwitching(true);
    try {
      // For platform accounts, we don't need to send profile data
      const requestBody = isPlatformAccount 
        ? { address, role: r }
        : { address, role: r };

      const response = await fetch('/api/user/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      
      if (response.ok) {
        setOpen(false);
        // Refetch the role to update the UI
        await refetch();
        // Navigate to the new role page
        router.push(`/${r.toLowerCase()}`);
      } else {
        const errorData = await response.json();
        console.error('Failed to switch role:', errorData);
        // Show user-friendly error message
        alert(`Failed to switch role: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error switching role:', error);
      alert('Network error while switching roles. Please try again.');
    } finally {
      setSwitching(false);
    }
  };

  const getRoleDisplayName = (r: Role) => {
    if (!r) return 'Guest';
    return r.charAt(0) + r.slice(1).toLowerCase();
  };

  const getRoleIcon = (r: Role) => {
    switch (r) {
      case 'FARMER':
        return '🌾';
      case 'BUYER':
        return '🛒';
      case 'TRANSPORTER':
        return '🚛';
      case 'PLATFORM':
        return '⚙️';
      default:
        return '👤';
    }
  };

  if (!address) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 bg-ocean-navy text-warm-white px-4 py-3 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-ocean-navy/90 transition-colors"
      >
        <span className="text-lg">{getRoleIcon(role)}</span>
        <span className="font-medium">{getRoleDisplayName(role)}</span>
        <ChevronDown className="w-4 h-4" />
      </button>
      
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Switch Role">
        <div className="space-y-3">
          <p className="text-sm text-dusk-gray mb-4">
            {isPlatformAccount 
              ? "Choose the role you want to act as. As a platform administrator, you can switch between all roles freely."
              : "Choose the role you want to act as. You can switch between roles anytime."
            }
          </p>
          {(['FARMER', 'BUYER', 'TRANSPORTER', 'PLATFORM'] as Role[]).map((r) => (
            <Button
              key={r}
              variant={role === r ? 'secondary' : 'primary'}
              onClick={() => switchRole(r)}
              className="w-full flex items-center gap-3 justify-start"
              disabled={role === r || switching}
            >
              <span className="text-lg">{getRoleIcon(r)}</span>
              <span>{getRoleDisplayName(r)}</span>
              {role === r && <span className="ml-auto text-xs opacity-70">Current</span>}
              {switching && <span className="ml-auto text-xs opacity-70">Switching...</span>}
            </Button>
          ))}
        </div>
      </Modal>
    </>
  );
}
