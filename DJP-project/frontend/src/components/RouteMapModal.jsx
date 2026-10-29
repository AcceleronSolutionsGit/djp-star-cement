import React, { useState, useEffect, useRef } from 'react';
import { X, MapPin, Navigation, Compass, Calendar, ChevronRight, Layers, ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

/**
 * RouteMapModal - Interactive Heuristic Route Map Viewer
 * 
 * Displays optimized day-by-day travel routes for an officer's plan using
 * GPS coordinates from the Star SFA customer base API.
 */
export default function RouteMapModal({ planId, planSummary, onClose }) {
  const [routeData, setRouteData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [useOsm, setUseOsm] = useState(true);

  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markersRef = useRef([]);
  const polylineRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    async function loadRoute() {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getPlanRouteMap(planId);
        if (isMounted) {
          setRouteData(data);
          if (data?.days?.length > 0) setSelectedDayIndex(0);
        }
      } catch (err) {
        if (isMounted) setError(err.message || 'Failed to load route map');
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadRoute();
    return () => { isMounted = false; };
  }, [planId]);

  const currentDay = routeData?.days?.[selectedDayIndex] || null;
  const stops = currentDay?.stops || [];
  const validStops = stops.filter(s => s.latitude && s.longitude && (s.latitude !== 0 || s.longitude !== 0));

  // Dynamically initialize Leaflet map if OpenStreetMap is enabled
  useEffect(() => {
    if (!mapContainerRef.current || !validStops.length || !useOsm) return;

    let map = leafletMapRef.current;

    const initMap = () => {
      if (!window.L) return;

      if (!map) {
        map = window.L.map(mapContainerRef.current, {
          zoomControl: true,
          attributionControl: false
        });
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19
        }).addTo(map);
        leafletMapRef.current = map;
      }

      // Clear existing markers & polylines
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      if (polylineRef.current) {
        polylineRef.current.remove();
        polylineRef.current = null;
      }

      const latLngs = [];

      validStops.forEach((stop, idx) => {
        const pos = [stop.latitude, stop.longitude];
        latLngs.push(pos);

        const iconHtml = `
          <div style="
            background: ${idx === 0 ? '#10B981' : '#2563EB'};
            color: #FFFFFF;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            font-weight: 700;
            border: 2px solid #FFFFFF;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          ">${stop.sequence}</div>
        `;

        const customIcon = window.L.divIcon({
          html: iconHtml,
          className: 'route-stop-pin',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          popupAnchor: [0, -14]
        });

        const marker = window.L.marker(pos, { icon: customIcon }).addTo(map);
        marker.bindPopup(`
          <div style="font-family: system-ui, sans-serif; font-size: 12px; padding: 4px;">
            <div style="font-weight: 700; font-size: 13px; margin-bottom: 2px; color: #1E293B;">
              Stop #${stop.sequence}: ${stop.dealerName}
            </div>
            <div style="color: #64748B; font-family: monospace; font-size: 11px;">${stop.dealerSapCode || stop.dealerSfaCode || ''}</div>
            <div style="margin-top: 4px;"><strong>Route:</strong> ${stop.routeName || stop.block || 'Local Area'}</div>
            ${stop.distanceFromPrevKm > 0 ? `<div style="color: #059669; margin-top: 2px;"><strong>+${stop.distanceFromPrevKm} km</strong> from previous stop</div>` : '<div style="color: #059669;">🏁 Starting Stop</div>'}
            <div style="font-size: 10px; color: #94A3B8; margin-top: 4px;">Coords: ${stop.latitude.toFixed(5)}, ${stop.longitude.toFixed(5)}</div>
          </div>
        `);
        markersRef.current.push(marker);
      });

      if (latLngs.length > 1) {
        polylineRef.current = window.L.polyline(latLngs, {
          color: '#2563EB',
          weight: 4,
          opacity: 0.85,
          dashArray: '6, 6'
        }).addTo(map);
      }

      if (latLngs.length > 0) {
        const bounds = window.L.latLngBounds(latLngs);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    };

    if (window.L) {
      initMap();
    } else {
      // Load Leaflet dynamically from unpkg
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => initMap();
      script.onerror = () => setUseOsm(false); // fallback to vector SVG
      document.head.appendChild(script);
    }
  }, [selectedDayIndex, validStops.length, useOsm]);

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div 
        className="modal-dialog fullscreen" 
        onClick={e => e.stopPropagation()} 
        style={{ maxWidth: 1180, width: '95vw', height: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-header" style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'var(--color-primary-soft, #EEF2FF)',
              color: 'var(--color-primary, #4F46E5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Compass size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                Heuristic Route Map · Plan #{planId}
              </div>
              <div style={{ fontSize: '.76rem', color: 'var(--text-tertiary)' }}>
                {routeData?.empName || planSummary?.employee?.emp_name} ({routeData?.role || planSummary?.emp_role}) · 
                {routeData?.periodMonth || planSummary?.period_month} {routeData?.cycleCode || planSummary?.cycle_code}
                {routeData?.totalDistanceKm ? ` · Total Est. Route: ${routeData.totalDistanceKm} km` : ''}
              </div>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={19} /></button>
        </div>

        <div className="modal-body" style={{ flex: 1, display: 'flex', padding: 0, overflow: 'hidden' }}>
          {loading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-secondary)' }}>
              <RefreshCw size={20} className="spin" />
              <span>Optimizing and loading heuristic route map...</span>
            </div>
          )}

          {error && (
            <div style={{ flex: 1, padding: 30, textAlign: 'center', color: 'var(--color-danger)' }}>
              <div>{error}</div>
              <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={onClose}>Close</button>
            </div>
          )}

          {!loading && !error && routeData && (
            <>
              {/* Left Pane: Working Days List & Stop Sequence */}
              <div style={{
                width: 380,
                borderRight: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--bg-secondary, #F9FAFB)'
              }}>
                {/* Working Days Selector Strip */}
                <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-primary, #FFFFFF)' }}>
                  <div style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                    Working Days ({routeData.days.length})
                  </div>
                  <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                    {routeData.days.map((d, idx) => (
                      <button
                        key={d.visitDate}
                        onClick={() => setSelectedDayIndex(idx)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 6,
                          fontSize: '.75rem',
                          fontWeight: 600,
                          border: selectedDayIndex === idx ? '1px solid var(--color-primary, #4F46E5)' : '1px solid var(--border-color)',
                          background: selectedDayIndex === idx ? 'var(--color-primary-soft, #EEF2FF)' : 'var(--bg-primary, #FFFFFF)',
                          color: selectedDayIndex === idx ? 'var(--color-primary, #4F46E5)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center'
                        }}
                      >
                        <span>{d.visitDate.slice(5)}</span>
                        <span style={{ fontSize: '.65rem', opacity: 0.8 }}>{d.visitCount} visits</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Day Header Info */}
                {currentDay && (
                  <div style={{ padding: '12px 16px', background: 'var(--bg-primary, #FFFFFF)', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--text-primary)' }}>
                        {currentDay.visitDate}
                      </div>
                      <span className="badge" style={{ background: '#E0F2FE', color: '#0369A1', fontSize: '.7rem' }}>
                        {currentDay.totalDistanceKm > 0 ? `🚗 ~${currentDay.totalDistanceKm} km` : 'Local route'}
                      </span>
                    </div>
                    <div style={{ fontSize: '.72rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
                      {currentDay.visitCount} scheduled visits · {currentDay.hasCoordinatesCount} GPS coordinates mapped
                    </div>
                  </div>
                )}

                {/* Stops Timeline */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                  {stops.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-tertiary)', fontSize: '.8rem' }}>
                      No visits scheduled for this date.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {stops.map((stop, sIdx) => (
                        <div key={stop.detailId || sIdx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          {/* Sequence pin & timeline line */}
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <div style={{
                              width: 24, height: 24, borderRadius: '50%',
                              background: sIdx === 0 ? '#10B981' : '#3B82F6',
                              color: '#FFFFFF',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '.72rem', fontWeight: 700
                            }}>
                              {stop.sequence}
                            </div>
                            {sIdx < stops.length - 1 && (
                              <div style={{ width: 2, height: 36, background: '#E2E8F0', margin: '3px 0' }} />
                            )}
                          </div>

                          {/* Stop details */}
                          <div style={{
                            flex: 1,
                            background: 'var(--bg-primary, #FFFFFF)',
                            padding: '8px 12px',
                            borderRadius: 6,
                            border: '1px solid var(--border-color)',
                            fontSize: '.78rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                              <strong style={{ color: 'var(--text-primary)' }}>{stop.dealerName}</strong>
                              {stop.distanceFromPrevKm > 0 && (
                                <span style={{ color: '#059669', fontSize: '.7rem', fontWeight: 600 }}>
                                  +{stop.distanceFromPrevKm} km
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '.7rem', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                              {stop.dealerSapCode || stop.dealerSfaCode}
                            </div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                              {stop.routeName && (
                                <span style={{ fontSize: '.68rem', color: '#475569', background: '#F1F5F9', padding: '1px 6px', borderRadius: 4 }}>
                                  📍 {stop.routeName}
                                </span>
                              )}
                              {stop.hasCoordinates ? (
                                <span style={{ fontSize: '.66rem', color: '#16A34A', background: '#DCFCE7', padding: '1px 6px', borderRadius: 4 }}>
                                  GPS Verified
                                </span>
                              ) : (
                                <span style={{ fontSize: '.66rem', color: '#D97706', background: '#FEF3C7', padding: '1px 6px', borderRadius: 4 }}>
                                  Route Name Match
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Pane: Interactive Route Map / Vector View */}
              <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
                <div 
                  ref={mapContainerRef} 
                  style={{ width: '100%', height: '100%', background: '#F8FAFC' }} 
                />

                {validStops.length === 0 && (
                  <div style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    textAlign: 'center', color: 'var(--text-tertiary)', background: 'rgba(255,255,255,0.9)',
                    padding: '20px 30px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                  }}>
                    <Navigation size={28} style={{ margin: '0 auto 8px', color: '#94A3B8' }} />
                    <div style={{ fontWeight: 600 }}>No GPS Coordinates Available for this Date</div>
                    <div style={{ fontSize: '.74rem', marginTop: 4 }}>Visits are grouped using SFA Route Names & Territory Blocks.</div>
                  </div>
                )}

                {/* Floating Map Overlay Info */}
                {validStops.length > 0 && currentDay && (
                  <div style={{
                    position: 'absolute', bottom: 16, right: 16,
                    background: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(4px)',
                    padding: '10px 16px',
                    borderRadius: 8,
                    border: '1px solid var(--border-color)',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                    fontSize: '.75rem',
                    zIndex: 900
                  }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Heuristic Route Tour</div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                      {validStops.length} GPS Waypoints · {currentDay.totalDistanceKm} km total
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer" style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)' }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

