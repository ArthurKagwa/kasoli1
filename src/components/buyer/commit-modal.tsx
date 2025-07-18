'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Truck, Calculator, MapPin, DollarSign, CheckCircle } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useReadContract, useAccount, useWriteContract } from 'wagmi';
import { CONTRACTS, ORACLE_ABI, ESCROW_ABI, ERC20_ABI } from '@/lib/contracts';
import { PLATFORM_CONFIG, calculatePlatformFee, convertUGXToUSD, formatCurrency } from '@/lib/constants';
import { keccak256, toBytes } from 'viem';
import toast from 'react-hot-toast';

interface CommitModalProps {
  isOpen: boolean;
  onClose: () => void;
  batch: any;
}

export function CommitModal({ isOpen, onClose, batch }: CommitModalProps) {
  const [distance, setDistance] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [freightCost, setFreightCost] = useState<bigint>(0n);
  const [step, setStep] = useState<'calculate' | 'confirm' | 'processing'>('calculate');
  const [isCalculatingDistance, setIsCalculatingDistance] = useState(false);
  const [distanceMethod, setDistanceMethod] = useState<string>('');
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const { data: freightQuote } = useReadContract({
    address: CONTRACTS.ORACLE as `0x${string}`,
    abi: ORACLE_ABI,
    functionName: 'quote',
    args: [
      BigInt(Math.floor(batch?.weightKg || 0)), // kg as integer
      BigInt(Math.floor(distance && !isNaN(parseFloat(distance)) ? parseFloat(distance) : 0)), // km as integer
    ],
    query: {
      enabled: !!batch && !!distance && !isNaN(parseFloat(distance)),
    },
  });


  useEffect(() => {
    const controller = new AbortController();
    if (locationInput.length > 2) {
      fetch(`/api/places?input=${encodeURIComponent(locationInput)}`, {
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data) => setSuggestions(data.predictions || []))
        .catch(() => {});
    } else {
      setSuggestions([]);
    }
    return () => controller.abort();
  }, [locationInput]);

  useEffect(() => {
    if (!coords || !batch) return;
    
    setIsCalculatingDistance(true);
    setDistance('');
    
    fetch(`/api/distance?batchId=${batch.id}&lat=${coords.lat}&lng=${coords.lng}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.distance !== undefined) {
          setDistance(data.distance.toFixed(2));
          setDistanceMethod(data.method || 'calculated');
          
          // Show user-friendly message based on calculation method
          if (data.method === 'google_maps') {
            toast.success(`Distance calculated: ${data.distanceText} (via roads)`);
          } else if (data.method === 'haversine_fallback') {
            toast.success(`Distance calculated: ${data.distanceText} (straight-line)`);
          }
        } else {
          toast.error('Failed to calculate distance');
        }
      })
      .catch((error) => {
        console.error('Distance calculation failed:', error);
        toast.error('Failed to calculate distance');
      })
      .finally(() => {
        setIsCalculatingDistance(false);
      });
  }, [coords, batch]);

  useEffect(() => {
    if (freightQuote) {
      setFreightCost(freightQuote);
    }
  }, [freightQuote]);

  const handleCalculate = () => {
    if (!distance) {
      toast.error('Please enter distance');
      return;
    }
    setStep('confirm');
  };

  const selectSuggestion = async (placeId: string, description: string) => {
    setLocationInput(description);
    setSuggestions([]);
    const res = await fetch(`/api/places?placeId=${placeId}`);
    const data = await res.json();
    const loc = data.result?.geometry?.location;
    if (loc) {
      setCoords({ lat: loc.lat, lng: loc.lng });
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by this browser');
      return;
    }

    toast.loading('Getting your location...', { id: 'location' });
    
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLocationInput('Current Location');
        setCoords({ lat: latitude, lng: longitude });
        toast.dismiss('location');
        toast.success('Location found! Calculating distance...');
      },
      (error) => {
        toast.dismiss('location');
        let message = 'Failed to get location';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = 'Location access denied. Please enable location permissions.';
            break;
          case error.POSITION_UNAVAILABLE:
            message = 'Location information unavailable';
            break;
          case error.TIMEOUT:
            message = 'Location request timed out';
            break;
        }
        toast.error(message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000 // 5 minutes
      }
    );
  };

  const handleCommit = async () => {
    if (!batch || !address) return;

    setStep('processing');

    try {
      const totalPrice = calculateTotalPrice(batch);
      const platformFee = calculatePlatformFee(totalPrice);
      const farmerAmount = totalPrice; // Store as regular USD amount, not Wei
      const freightAmountUSD = freightCost ? convertUGXToUSD(Number(freightCost)) : 0;
      const totalAmount = farmerAmount + freightAmountUSD + platformFee;

      console.log('Creating deal with:', {
        batchId: batch.id,
        farmerAmount: farmerAmount.toString(),
        platformFee: platformFee.toString(),
        freightAmount: freightAmountUSD.toString(),
        totalAmount: totalAmount.toString(),
        farmerAddress: batch.farmer?.walletAddress,
      });

      // Store deal in backend (no escrow funding yet)
      const dealResponse = await fetch('/api/deal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: batch.id,
          buyerAddress: address,
          farmerAmount: farmerAmount.toString(),
          platformFee: platformFee.toString(),
          freightAmount: freightAmountUSD.toString(),
          originLat: batch.locationLat,
          originLng: batch.locationLng,
          origin: batch.origin,
          destination: locationInput,
          destinationLat: coords?.lat ?? null,
          destinationLng: coords?.lng ?? null,
          distanceKm: distance ? parseFloat(distance) : null,
          weightKg: batch.weightKg,
        }),
      });

      if (!dealResponse.ok) {
        throw new Error('Failed to store deal in backend');
      }

      const deal = await dealResponse.json();
      console.log('Deal created successfully:', deal);

      toast.success('Deal committed successfully! Awaiting transporter assignment.');
      onClose();
    } catch (error: any) {
      console.error('Error committing deal:', error);
      
      // Provide more specific error messages
      let errorMessage = 'Failed to commit deal';
      if (error.message?.includes('Failed to store deal')) {
        errorMessage = 'Failed to store deal in database';
      }
      
      toast.error(errorMessage);
      setStep('confirm');
    }
  };

  const formatUGX = (ugx: bigint) => {
    return `UGX ${(Number(ugx) / 1000).toLocaleString()}`;
  };

  const formatUSD = (ugx: bigint) => {
    const usd = convertUGXToUSD(Number(ugx));
    return formatCurrency(usd);
  };

  const calculateTotalPrice = (batch: any): number => {
    if (!batch || !batch.weightKg || !batch.pricePerKg) return 0;
    return batch.weightKg * parseFloat(batch.pricePerKg);
  };

  const formatPrice = (amount: number): string => {
    return formatCurrency(amount);
  };

  if (!batch) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Commit Deal">
      {step === 'calculate' && (
        <div className="space-y-6">
          <div className="bg-lime-lush/10 rounded-xl p-4">
            <h3 className="font-semibold text-ocean-navy mb-2">Batch Details</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-dusk-gray">Farmer:</span>
                <span className="text-ocean-navy">{batch.farmer?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dusk-gray">Grade:</span>
                <span className="text-ocean-navy">{batch.grade}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dusk-gray">Weight:</span>
                <span className="text-ocean-navy">{batch.weightKg} kg</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dusk-gray">Price per Kg:</span>
                <span className="text-ocean-navy">{batch.pricePerKg ? `$${parseFloat(batch.pricePerKg).toFixed(2)}` : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dusk-gray">Total Price:</span>
                <span className="text-ocean-navy font-semibold">{formatPrice(calculateTotalPrice(batch))}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-ocean-navy">
              <MapPin size={16} className="inline mr-2" />
              Delivery Location
            </label>
            <input
              type="text"
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
              placeholder="Search location"
              className="w-full px-4 py-3 rounded-xl border border-dusk-gray/30 bg-warm-white text-ocean-navy placeholder-dusk-gray focus:outline-none focus:ring-2 focus:ring-lime-lush focus:border-transparent transition-all duration-200"
            />
          </div>
          {suggestions.length > 0 && (
            <div className="relative">
              <ul className="absolute top-0 left-0 right-0 z-50 border border-dusk-gray/30 rounded-xl bg-warm-white shadow-lg max-h-48 overflow-y-auto">
                {suggestions.map((s) => (
                  <li
                    key={s.place_id}
                    className="px-4 py-3 cursor-pointer hover:bg-lime-lush/20 text-ocean-navy text-sm border-b border-dusk-gray/10 last:border-b-0 transition-colors duration-150"
                    onClick={() => selectSuggestion(s.place_id, s.description)}
                  >
                    <div className="flex items-center">
                      <MapPin size={14} className="text-dusk-gray mr-2 flex-shrink-0" />
                      <span className="truncate">{s.description}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button type="button" variant="outline" onClick={useCurrentLocation} className="w-full">
            Use Current Location
          </Button>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-ocean-navy">
              <Truck size={16} className="inline mr-2" />
              Delivery Distance (km)
              {distanceMethod === 'google_maps' && (
                <span className="text-xs text-teal-deep ml-1">(Road distance)</span>
              )}
              {distanceMethod === 'haversine_fallback' && (
                <span className="text-xs text-dusk-gray ml-1">(Straight-line distance)</span>
              )}
            </label>
            <div className="relative">
              <input
                type="number"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                placeholder={isCalculatingDistance ? "Calculating..." : "Auto-calculated when location is selected"}
                className="w-full px-4 py-3 rounded-xl border border-dusk-gray/30 bg-warm-white text-ocean-navy placeholder-dusk-gray focus:outline-none focus:ring-2 focus:ring-lime-lush focus:border-transparent transition-all duration-200"
                disabled={isCalculatingDistance}
              />
              {isCalculatingDistance && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="w-5 h-5 border-2 border-lime-lush border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </div>
            {distance && !isCalculatingDistance && (
              <p className="text-xs text-teal-deep">
                ✓ Distance auto-calculated from your location to the batch origin
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleCalculate} className="flex-1">
              <Calculator size={16} className="mr-2" />
              Calculate Freight
            </Button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-6">
          <div className="bg-teal-deep/10 rounded-xl p-4">
            <h3 className="font-semibold text-ocean-navy mb-3">Deal Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-dusk-gray">Farmer Payment:</span>
                <span className="text-ocean-navy">{formatPrice(calculateTotalPrice(batch))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dusk-gray">Freight Cost:</span>
                <span className="text-ocean-navy">{formatUSD(freightCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dusk-gray">Platform Fee ({(PLATFORM_CONFIG.PLATFORM_FEE_RATE * 100).toFixed(0)}%):</span>
                <span className="text-ocean-navy">
                  {formatPrice(calculatePlatformFee(calculateTotalPrice(batch)))}
                </span>
              </div>
              <hr className="border-dusk-gray/20" />
              <div className="flex justify-between font-semibold">
                <span className="text-ocean-navy">Total:</span>
                <span className="text-ocean-navy">
                  {formatPrice(
                    calculateTotalPrice(batch) +
                    convertUGXToUSD(Number(freightCost)) +
                    calculatePlatformFee(calculateTotalPrice(batch))
                  )}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <p className="text-sm text-yellow-800">
              <strong>Note:</strong> Funds will be held in escrow until all parties sign off on delivery.
            </p>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('calculate')} className="flex-1">
              Back
            </Button>
            <Button onClick={handleCommit} className="flex-1">
              Commit
            </Button>
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="text-center py-8">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="w-16 h-16 border-4 border-lime-lush border-t-transparent rounded-full mx-auto mb-4"
          />
          <h3 className="text-lg font-semibold text-ocean-navy mb-2">
            Processing Payment
          </h3>
          <p className="text-dusk-gray">
            Locking funds in escrow contract...
          </p>
        </div>
      )}
    </Modal>
  );
}