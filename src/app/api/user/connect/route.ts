import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { address, role, profile } = await request.json();
    console.log('User connect request:', { address, role, profile });
    
    if (!address || !role) {
      return NextResponse.json({ error: 'Address and role required' }, { status: 400 });
    }

    const wallet = (address as string).toLowerCase();
    const platformAddress = process.env.NEXT_PUBLIC_PLATFORM_ADDRESS?.toLowerCase();
    const isPlatformAccount = platformAddress && wallet === platformAddress;

    // For platform accounts, profile is optional
    if (!isPlatformAccount) {
      // Validate email is provided for all user types (non-platform accounts)
      if (!profile?.email || !profile.email.trim()) {
        return NextResponse.json({ error: 'Email address is required for all user types' }, { status: 400 });
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(profile.email)) {
        return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
      }
    }

    const existing = await prisma.user.findUnique({ where: { walletAddress: wallet } });

    if (existing) {
      console.log('Existing user found:', existing);
      // Allow platform address to switch roles freely
      if (existing.currentRole !== role && isPlatformAccount) {
        // Update the user's current role
        await prisma.user.update({
          where: { walletAddress: wallet },
          data: { currentRole: role as any },
        });
      } else if (existing.currentRole !== role && !isPlatformAccount) {
        return NextResponse.json({ error: 'Role already assigned' }, { status: 400 });
      }
      
      // Update profile details if provided
      if (profile) {
        switch (role) {
          case 'FARMER':
            await prisma.farmer.update({
              where: { walletAddress: wallet },
              data: { 
                name: profile?.name, 
                phone: profile?.phone,
                email: profile?.email 
              },
            }).catch((err) => {
              console.error('Farmer update error:', err);
            });
            break;
          case 'BUYER':
            console.log('Updating buyer profile:', { wallet, profile });
            await prisma.buyer.update({
              where: { walletAddress: wallet },
              data: { 
                organisation: profile?.organisation, 
                contactName: profile?.contactName, 
                phone: profile?.phone,
                email: profile?.email 
              },
            }).catch((err) => {
              console.error('Buyer update error:', err);
            });
            break;
          case 'TRANSPORTER':
            await prisma.transporter.update({
              where: { walletAddress: wallet },
              data: { 
                name: profile?.name, 
                vehicleReg: profile?.vehicleReg, 
                phone: profile?.phone,
                email: profile?.email 
              },
            }).catch((err) => {
              console.error('Transporter update error:', err);
            });
            break;
          case 'PLATFORM':
            await prisma.platform.update({
              where: { id: 1 },
              data: { 
                walletAddress: wallet, 
                name: profile?.name, 
                url: profile?.url,
                email: profile?.email 
              },
            }).catch((err) => {
              console.error('Platform update error:', err);
            });
            break;
        }
      }
      return NextResponse.json({ success: true });
    }

    console.log('Creating new user:', { wallet, role, profile });
    await prisma.user.create({
      data: { 
        walletAddress: wallet, 
        currentRole: role,
        email: profile?.email || (isPlatformAccount ? 'platform@kasoli.com' : '')
      },
    });

    // For platform accounts, create minimal profiles for all roles if they don't exist
    if (isPlatformAccount) {
      // Create or update profiles for all roles
      const defaultProfile = {
        name: 'Platform Admin',
        organisation: 'Kasoli Platform',
        contactName: 'Platform Admin',
        vehicleReg: 'PLATFORM-001',
        phone: '+256-000-000-000',
        email: 'platform@kasoli.com',
        url: 'https://kasoli.com'
      };

      // Ensure all role profiles exist for platform account
      await Promise.all([
        prisma.farmer.upsert({
          where: { walletAddress: wallet },
          update: {},
          create: {
            walletAddress: wallet,
            name: defaultProfile.name,
            phone: defaultProfile.phone,
            email: defaultProfile.email
          },
        }),
        prisma.buyer.upsert({
          where: { walletAddress: wallet },
          update: {},
          create: {
            walletAddress: wallet,
            organisation: defaultProfile.organisation,
            contactName: defaultProfile.contactName,
            phone: defaultProfile.phone,
            email: defaultProfile.email
          },
        }),
        prisma.transporter.upsert({
          where: { walletAddress: wallet },
          update: {},
          create: {
            walletAddress: wallet,
            name: defaultProfile.name,
            vehicleReg: defaultProfile.vehicleReg,
            phone: defaultProfile.phone,
            email: defaultProfile.email
          },
        }),
        prisma.platform.upsert({
          where: { id: 1 },
          update: {},
          create: {
            id: 1,
            walletAddress: wallet,
            name: defaultProfile.name,
            url: defaultProfile.url,
            email: defaultProfile.email
          },
        })
      ]);
    } else {
      // Regular user creation with profile
      switch (role) {
        case 'FARMER':
          console.log('Creating farmer profile');
          await prisma.farmer.create({
            data: { 
              walletAddress: wallet, 
              name: profile?.name ?? null, 
              phone: profile?.phone ?? null,
              email: profile?.email ?? null 
            },
          });
          break;
        case 'BUYER':
          console.log('Creating buyer profile:', { wallet, profile });
          await prisma.buyer.create({
            data: { 
              walletAddress: wallet, 
              organisation: profile?.organisation ?? null, 
              contactName: profile?.contactName ?? null, 
              phone: profile?.phone ?? null,
              email: profile?.email ?? null 
            },
          });
          break;
        case 'TRANSPORTER':
          console.log('Creating transporter profile');
          await prisma.transporter.create({
            data: { 
              walletAddress: wallet, 
              name: profile?.name ?? null, 
              vehicleReg: profile?.vehicleReg ?? null, 
              phone: profile?.phone ?? null,
              email: profile?.email ?? null 
            },
          });
          break;
        case 'PLATFORM':
          console.log('Creating platform profile');
          await prisma.platform.create({
            data: { 
              id: 1, 
              walletAddress: wallet, 
              name: profile?.name ?? null, 
              url: profile?.url ?? null,
              email: profile?.email ?? null 
            },
          });
          break;
        default:
          return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }
    }

    console.log('User registration successful');
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to connect user', err);
    return NextResponse.json({ 
      error: 'Server error', 
      details: err instanceof Error ? err.message : 'Unknown error'
    }, { status: 500 });
  }
}
