import {describe,it,expect} from 'vitest';
import {deviceLayout} from '../src/core/device';

describe('device identity isolates TV and handheld layouts',()=>{
  it('keeps a TV layout even when its WebView advertises touch input',()=>{
    expect(deviceLayout('Android 12 RezkaDeviceTV',true,10)).toBe('tv');
    expect(deviceLayout('Android TV',true,1)).toBe('tv');
  });
  it('uses touch layouts on native phones and tablets independent of screen width',()=>{
    expect(deviceLayout('Android 15 RezkaDeviceTouch')).toBe('touch');
    expect(deviceLayout('Mozilla Android 14 Mobile')).toBe('touch');
    expect(deviceLayout('Mozilla Android 14')).toBe('touch');
  });
  it('supports touch browsers and preserves the existing Mac TV testing layout',()=>{
    expect(deviceLayout('Mozilla Macintosh',true,5)).toBe('touch');
    expect(deviceLayout('Mozilla Macintosh',false,0)).toBe('tv');
    expect(deviceLayout('Mozilla iPhone')).toBe('touch');
  });
});
