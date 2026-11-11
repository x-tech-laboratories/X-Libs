import { describe, expect, it } from "vitest";

import { discovery_topic, reading_traits, slug } from "../../src/server/mqtt_discovery.ts";

describe("mqtt discovery", () => {
  it("makes ids safe as topic levels", () => {
    expect(slug("My Host.lan/CPU")).toBe("my_host_lan_cpu");
    expect(slug("__x__")).toBe("x");
    expect(slug("///")).toBe("unnamed");
  });

  it("names the config topic of an entity", () => {
    expect(discovery_topic("homeassistant", "sensor", "App CPU", "load avg")).toBe("homeassistant/sensor/app_cpu/load_avg/config");
  });

  it("reads the device class and unit from a reading's name ending", () => {
    expect(reading_traits("cpu_temp_c")).toEqual({ state_class: "measurement", device_class: "temperature", unit_of_measurement: "°C" });
    expect(reading_traits("Used_Bytes")).toMatchObject({ device_class: "data_size", unit_of_measurement: "B" });
    expect(reading_traits("load")).toEqual({ state_class: "measurement" });
    expect(reading_traits("power_w")).toMatchObject({ device_class: "power" });
  });
});
