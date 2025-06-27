import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

interface Context {
  params: {
    dealId: string;
  };
}

export async function POST(
  request: NextRequest,
  context: Context,
) {
  const { params } = context;
  try {
    const { escrowTxHash } = await request.json();
    const { dealId } = params;

    if (!escrowTxHash) {
      return NextResponse.json({ error: 'escrowTxHash is required' }, { status: 400 });
    }

    // Update the deal status and store the escrow transaction hash
    const updatedDeal = await prisma.deal.update({
      where: { id: dealId },
      data: {
        status: 'PENDING_SIGS',
        escrowTxHash,
      },
      include: {
        batch: true,
        buyer: true,
        transporter: true,
        signatures: true,
      },
    });

    return NextResponse.json(updatedDeal);
  } catch (error) {
    console.error('Failed to update deal with escrow payment:', error);
    return NextResponse.json({ error: 'Failed to update deal with escrow payment' }, { status: 500 });
  }
} 