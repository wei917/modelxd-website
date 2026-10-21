// lib/xgame-speed-results.ts — WRITTEN BY scripts/xgame-speed-test.ts; do
// not edit by hand. Per game, per model id, per thinking level ('auto' =
// the model's default): the test moves' times in ms and whether two of
// them came back readable within the game's limit plus margin
// (lib/xgame-speed.ts).

export const XGAME_SPEED = {
  measuredAt: "2026-10-21T05:10:49.169Z" as string | null,
  results: {
  "chess": {
    "906eda14-1219-43a1-bc04-b746cc95b05f": {
      "name": "GPT-5.5 Pro",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36001,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "3ca6b5bb-1498-459a-8f0a-ce5458c9ed8f": {
      "name": "Qwen3.8 Max",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3072,
            2388
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            3072,
            2388
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            36001,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "0f4a8e97-7ce6-4876-919a-58c5c972cc55": {
      "name": "Gemini 3.1 Pro Preview",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            7826,
            10050
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            5904,
            14343
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            5559,
            6971
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            13550,
            7153
          ]
        }
      }
    },
    "01ab10d3-ff15-45f9-ada0-8185712256e7": {
      "name": "Claude Opus 5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            4906,
            3092
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2410,
            2059
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            5348,
            2058
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            8585,
            3795
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            11320,
            3935
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            10076,
            6672
          ]
        }
      }
    },
    "ed31b573-a244-4877-84d1-a33af9f37fd7": {
      "name": "GPT-6 Astra",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            13914,
            8836
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            7845,
            4636
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            9343,
            6400
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            20491,
            9230
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            31338,
            24342
          ]
        },
        "max": {
          "pass": false,
          "ms": [
            36000,
            35181
          ],
          "note": "still thinking at 36 s; over the limit (35.2 s)"
        }
      }
    },
    "4250c2c4-11b0-481c-bd27-75e0500a10e4": {
      "name": "Kimi K3",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36001,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            36002,
            25123,
            5571
          ],
          "note": "still thinking at 36 s"
        },
        "high": {
          "pass": false,
          "ms": [
            36002,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "3ab87d24-4ae7-45d0-bf9b-40183305863c": {
      "name": "Claude Sonnet 5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            29068,
            1724
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1146,
            1034
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2270,
            1450
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            12787,
            1454
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            36002,
            5394,
            1796
          ],
          "note": "still thinking at 36 s"
        },
        "max": {
          "pass": false,
          "ms": [
            36003,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "81fddb7d-dac7-4376-8db6-f7d83b2860a2": {
      "name": "GPT-6 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            18271,
            9239
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1620,
            1168
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            8426,
            3231
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            32458,
            8660
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            27558,
            14744
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            31141,
            19828
          ]
        },
        "max": {
          "pass": false,
          "ms": [
            36000,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "56986b48-64e6-44fa-b460-fc1c35aadf42": {
      "name": "Grok 4.6",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36003,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            10961,
            6594
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            36001,
            31814,
            25745
          ],
          "note": "still thinking at 36 s"
        },
        "high": {
          "pass": false,
          "ms": [
            36002,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "8837c35c-90fd-4975-a3fa-05e64c268ce1": {
      "name": "GPT-6 Luna",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            24459,
            23833
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1696,
            1560
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            12647,
            19080
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            26410,
            36002,
            26657
          ],
          "note": "still thinking at 36 s"
        },
        "high": {
          "pass": false,
          "ms": [
            36001,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "2fe04f34-853a-465c-abb7-e61ac2c046a3": {
      "name": "Claude Opus 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3405,
            2499
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2782,
            2359
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            3483,
            7361
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            7528,
            7045
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            7161,
            4968
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            21089,
            21925
          ]
        }
      }
    },
    "7ba78edd-65c2-4607-b8ed-c447bd876c2b": {
      "name": "GPT-5.6 Terra",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            22133,
            5210
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1330,
            1408
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            22730,
            7048
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            26321,
            3550
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            32232,
            4551
          ]
        },
        "xhigh": {
          "pass": false,
          "ms": [
            36002,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "8c74d644-7590-4b53-9c84-5d54ee560812": {
      "name": "Claude Fable 5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            4520,
            3680
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            3277,
            3339
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            4028,
            3696
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            7509,
            3852
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            9042,
            4469
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            36001,
            12032,
            13782
          ],
          "note": "still thinking at 36 s"
        }
      }
    },
    "60c27ceb-f209-427a-a359-5da744a8c459": {
      "name": "Gemini 3.5 Flash-Lite",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            814,
            910
          ]
        },
        "minimal": {
          "pass": true,
          "ms": [
            705,
            691
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1485,
            1396
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            5787,
            2698
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            8029,
            7901
          ]
        }
      }
    },
    "6d43b0d7-0b7f-46dc-ba8e-64c93283c80a": {
      "name": "Gemini 3.1 Flash-Lite",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1108,
            842
          ]
        },
        "minimal": {
          "pass": true,
          "ms": [
            780,
            1896
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1871,
            1104
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2521,
            2387
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            10820,
            5569
          ]
        }
      }
    },
    "19166e5a-6423-4f51-936e-f26d2fdb4f21": {
      "name": "Grok 4.7",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36001,
            33808
          ],
          "note": "still thinking at 36 s; over the limit (33.8 s)"
        },
        "low": {
          "pass": true,
          "ms": [
            20454,
            15761
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            36001,
            21932,
            12895
          ],
          "note": "still thinking at 36 s"
        },
        "high": {
          "pass": false,
          "ms": [
            36002,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "6dac4b2f-633c-4ce4-b130-6b295be2bca4": {
      "name": "Gemini 3.8 Flash",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            6189,
            3889
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2442,
            2839
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            7648,
            3470
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            12675,
            14508
          ]
        }
      }
    },
    "8f126f31-538b-4f28-8e82-5a3afb15859a": {
      "name": "GPT-6.1 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            8975,
            9014
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            13541,
            6132
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            10222,
            12141
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            12613,
            17249
          ]
        },
        "xhigh": {
          "pass": false,
          "ms": [
            35052,
            36002
          ],
          "note": "over the limit (35.1 s); still thinking at 36 s"
        }
      }
    },
    "4d0e2bac-e7a0-4015-ae9f-38a8c52783cf": {
      "name": "Gemini 4 Argon",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3934,
            3212
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            12698,
            4199
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            4371,
            4871
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            12690,
            10100
          ]
        }
      }
    },
    "b655239d-3714-46d6-af40-adcf487e145c": {
      "name": "GPT-5.5",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36002,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "none": {
          "pass": true,
          "ms": [
            1960,
            2368
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            18744,
            6314
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            36003,
            18847,
            10094
          ],
          "note": "still thinking at 36 s"
        },
        "high": {
          "pass": false,
          "ms": [
            36001,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "03cd37d2-5baf-4c7c-bf24-bc52da9cdd97": {
      "name": "Claude Opus 4.8",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2396,
            2206
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            12387,
            2400
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            27387,
            3199
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            28532,
            3459
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            36002,
            14888,
            9994
          ],
          "note": "still thinking at 36 s"
        },
        "max": {
          "pass": false,
          "ms": [
            36001,
            33964
          ],
          "note": "still thinking at 36 s; over the limit (34.0 s)"
        }
      }
    },
    "488d4156-c49e-4eeb-afc7-93760b7bb4f1": {
      "name": "Qwen 3.8 Flash",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2280,
            1964
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            2280,
            1964
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            36002,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "22293dda-c228-40a2-affa-6f53ef990725": {
      "name": "GPT-5.6 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            21765,
            32270
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1729,
            1483
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            23738,
            8155
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            35439,
            9379,
            5637
          ],
          "note": "over the limit (35.4 s)"
        },
        "high": {
          "pass": true,
          "ms": [
            36002,
            19747,
            10566
          ],
          "note": "still thinking at 36 s"
        },
        "xhigh": {
          "pass": false,
          "ms": [
            36002,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "aea7b9eb-7bd2-45ac-9f7f-3ed8c2534f79": {
      "name": "Qwen 3.6-Plus",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1601,
            2625
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            1601,
            2625
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            36000,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "1bf8eb59-d094-4f09-ad1f-6e3c93edc21d": {
      "name": "Claude Sonnet 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3820,
            3353
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            4625,
            4239
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            4053,
            4041
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3608,
            4710
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            7883,
            8057
          ]
        },
        "max": {
          "pass": false,
          "ms": [
            36001,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "cb044218-3634-49e7-a1aa-588cf1009062": {
      "name": "Claude Fable 5.1",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            4383,
            2226
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2967,
            2466
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            3244,
            2365
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3549,
            4274
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            11675,
            3591
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            12000,
            36001,
            9702
          ],
          "note": "still thinking at 36 s"
        }
      }
    },
    "60180614-4fe3-4b37-b2dc-220789cf19ed": {
      "name": "GPT-5.6 Luna",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            23458,
            25727
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1739,
            1184
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            23538,
            16528
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            28804,
            17385
          ]
        },
        "high": {
          "pass": false,
          "ms": [
            36002,
            34137
          ],
          "note": "still thinking at 36 s; over the limit (34.1 s)"
        }
      }
    },
    "97f6ba2c-675a-410a-8e02-57751a167570": {
      "name": "Claude Haiku 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            9367,
            9683
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            6196,
            6986
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            8510,
            6908
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            13562,
            8726
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            32529,
            28274
          ]
        },
        "max": {
          "pass": false,
          "ms": [
            36001,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    }
  },
  "xiangqi": {
    "906eda14-1219-43a1-bc04-b746cc95b05f": {
      "name": "GPT-5.5 Pro",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36000,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "3ca6b5bb-1498-459a-8f0a-ce5458c9ed8f": {
      "name": "Qwen3.8 Max",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2209,
            3223
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            2209,
            3223
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            36001,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "4250c2c4-11b0-481c-bd27-75e0500a10e4": {
      "name": "Kimi K3",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36006,
            36005
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": false,
          "ms": [
            35989,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "8837c35c-90fd-4975-a3fa-05e64c268ce1": {
      "name": "GPT-6 Luna",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            21786,
            26074
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            2529,
            1975
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            11507,
            8944
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            32688,
            16309
          ]
        },
        "high": {
          "pass": false,
          "ms": [
            36001,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "56986b48-64e6-44fa-b460-fc1c35aadf42": {
      "name": "Grok 4.6",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36008,
            36005
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            17175,
            31324
          ]
        },
        "medium": {
          "pass": false,
          "ms": [
            35992,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "0f4a8e97-7ce6-4876-919a-58c5c972cc55": {
      "name": "Gemini 3.1 Pro Preview",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36003,
            36003
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            6453,
            8455
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            9361,
            23195
          ]
        },
        "high": {
          "pass": false,
          "ms": [
            35989,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "ed31b573-a244-4877-84d1-a33af9f37fd7": {
      "name": "GPT-6 Astra",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            36007,
            15994,
            18864
          ],
          "note": "still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            14345,
            10920
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            35997,
            29541,
            11467
          ],
          "note": "still thinking at 36 s"
        },
        "high": {
          "pass": false,
          "ms": [
            35996,
            28364,
            34121
          ],
          "note": "still thinking at 36 s; over the limit (34.1 s)"
        }
      }
    },
    "01ab10d3-ff15-45f9-ada0-8185712256e7": {
      "name": "Claude Opus 5",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36002,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            11112,
            11071
          ]
        },
        "medium": {
          "pass": false,
          "ms": [
            36001,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "81fddb7d-dac7-4376-8db6-f7d83b2860a2": {
      "name": "GPT-6 Sol",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            35988,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "none": {
          "pass": true,
          "ms": [
            1874,
            1820
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            18582,
            10314
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            36000,
            22300,
            23386
          ],
          "note": "still thinking at 36 s"
        },
        "high": {
          "pass": false,
          "ms": [
            36001,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "19166e5a-6423-4f51-936e-f26d2fdb4f21": {
      "name": "Grok 4.7",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36002,
            36003
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": false,
          "ms": [
            36000,
            36003
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "3ab87d24-4ae7-45d0-bf9b-40183305863c": {
      "name": "Claude Sonnet 5",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36003,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            21892,
            36002,
            25811
          ],
          "note": "still thinking at 36 s"
        },
        "medium": {
          "pass": false,
          "ms": [
            36001,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "b655239d-3714-46d6-af40-adcf487e145c": {
      "name": "GPT-5.5",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36001,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "none": {
          "pass": true,
          "ms": [
            1661,
            1658
          ]
        },
        "low": {
          "pass": false,
          "ms": [
            36002,
            19996,
            33524
          ],
          "note": "still thinking at 36 s; over the limit (33.5 s)"
        }
      }
    },
    "60c27ceb-f209-427a-a359-5da744a8c459": {
      "name": "Gemini 3.5 Flash-Lite",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            831,
            818
          ]
        },
        "minimal": {
          "pass": true,
          "ms": [
            680,
            776
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            659,
            784
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            4031,
            3850
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            27577,
            8833
          ]
        }
      }
    },
    "2fe04f34-853a-465c-abb7-e61ac2c046a3": {
      "name": "Claude Opus 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            30228,
            11510
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            9505,
            12170
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            36001,
            19552,
            13351
          ],
          "note": "still thinking at 36 s"
        },
        "high": {
          "pass": true,
          "ms": [
            36003,
            19763,
            21755
          ],
          "note": "still thinking at 36 s"
        },
        "xhigh": {
          "pass": true,
          "ms": [
            36001,
            29965,
            20830
          ],
          "note": "still thinking at 36 s"
        },
        "max": {
          "pass": false,
          "ms": [
            36002,
            36003
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "8c74d644-7590-4b53-9c84-5d54ee560812": {
      "name": "Claude Fable 5",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36002,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            11963,
            25745
          ]
        },
        "medium": {
          "pass": false,
          "ms": [
            26895,
            36001,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "22293dda-c228-40a2-affa-6f53ef990725": {
      "name": "GPT-5.6 Sol",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36001,
            32637,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "none": {
          "pass": true,
          "ms": [
            1527,
            1692
          ]
        },
        "low": {
          "pass": false,
          "ms": [
            36002,
            29062,
            36003
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "6d43b0d7-0b7f-46dc-ba8e-64c93283c80a": {
      "name": "Gemini 3.1 Flash-Lite",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            767,
            751
          ]
        },
        "minimal": {
          "pass": true,
          "ms": [
            748,
            748
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1006,
            1172
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2137,
            5143
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            8687,
            18630
          ]
        }
      }
    },
    "7ba78edd-65c2-4607-b8ed-c447bd876c2b": {
      "name": "GPT-5.6 Terra",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            36001,
            24300,
            22349
          ],
          "note": "still thinking at 36 s"
        },
        "none": {
          "pass": true,
          "ms": [
            1438,
            1334
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            36003,
            24513,
            19685
          ],
          "note": "still thinking at 36 s"
        },
        "medium": {
          "pass": true,
          "ms": [
            20072,
            33152,
            22085
          ],
          "note": "over the limit (33.2 s)"
        },
        "high": {
          "pass": false,
          "ms": [
            36001,
            36003
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "8f126f31-538b-4f28-8e82-5a3afb15859a": {
      "name": "GPT-6.1 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            34859,
            19771,
            20951
          ],
          "note": "over the limit (34.9 s)"
        },
        "low": {
          "pass": true,
          "ms": [
            16890,
            13853
          ]
        },
        "medium": {
          "pass": false,
          "ms": [
            31573,
            36002,
            36003
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "488d4156-c49e-4eeb-afc7-93760b7bb4f1": {
      "name": "Qwen 3.8 Flash",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2620,
            2414
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            2620,
            2414
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            36002,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "03cd37d2-5baf-4c7c-bf24-bc52da9cdd97": {
      "name": "Claude Opus 4.8",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2633,
            2425
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            36002,
            22462,
            23859
          ],
          "note": "still thinking at 36 s"
        },
        "medium": {
          "pass": false,
          "ms": [
            36002,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "4d0e2bac-e7a0-4015-ae9f-38a8c52783cf": {
      "name": "Gemini 4 Argon",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            4052,
            5837
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            6143,
            2878
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            18619,
            5281
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            36001,
            17034,
            32837
          ],
          "note": "still thinking at 36 s"
        }
      }
    },
    "aea7b9eb-7bd2-45ac-9f7f-3ed8c2534f79": {
      "name": "Qwen 3.6-Plus",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1703,
            2098
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            1703,
            2098
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            36002,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "6dac4b2f-633c-4ce4-b130-6b295be2bca4": {
      "name": "Gemini 3.8 Flash",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            17395,
            36001,
            14341
          ],
          "note": "still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            7872,
            13080
          ]
        },
        "medium": {
          "pass": false,
          "ms": [
            17102,
            36003,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "60180614-4fe3-4b37-b2dc-220789cf19ed": {
      "name": "GPT-5.6 Luna",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36003,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "none": {
          "pass": true,
          "ms": [
            1533,
            1614
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            23813,
            27257
          ]
        },
        "medium": {
          "pass": false,
          "ms": [
            36001,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "97f6ba2c-675a-410a-8e02-57751a167570": {
      "name": "Claude Haiku 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            10143,
            15218
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            6624,
            11062
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            14074,
            14163
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            10779,
            18679
          ]
        },
        "xhigh": {
          "pass": false,
          "ms": [
            36002,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "1bf8eb59-d094-4f09-ad1f-6e3c93edc21d": {
      "name": "Claude Sonnet 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            36002,
            17755,
            12325
          ],
          "note": "still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            1911,
            3369
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            7517,
            11008
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            12764,
            10794
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            36002,
            17201,
            21206
          ],
          "note": "still thinking at 36 s"
        },
        "max": {
          "pass": false,
          "ms": [
            36002,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "cb044218-3634-49e7-a1aa-588cf1009062": {
      "name": "Claude Fable 5.1",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36003,
            26057,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            19950,
            33617,
            25814
          ],
          "note": "over the limit (33.6 s)"
        },
        "medium": {
          "pass": true,
          "ms": [
            31557,
            16314
          ]
        },
        "high": {
          "pass": false,
          "ms": [
            36002,
            29646,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    }
  },
  "gomoku": {
    "906eda14-1219-43a1-bc04-b746cc95b05f": {
      "name": "GPT-5.5 Pro",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            31204,
            36001,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "3ca6b5bb-1498-459a-8f0a-ce5458c9ed8f": {
      "name": "Qwen3.8 Max",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            9363,
            1879
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            9363,
            1879
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            36002,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "4250c2c4-11b0-481c-bd27-75e0500a10e4": {
      "name": "Kimi K3",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36003,
            36004
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": false,
          "ms": [
            24602,
            36001,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "56986b48-64e6-44fa-b460-fc1c35aadf42": {
      "name": "Grok 4.6",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36002,
            36006
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            20922,
            14732
          ]
        },
        "medium": {
          "pass": false,
          "ms": [
            36001,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "0f4a8e97-7ce6-4876-919a-58c5c972cc55": {
      "name": "Gemini 3.1 Pro Preview",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36001,
            36003
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            11418,
            14707
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            25050,
            15837
          ]
        },
        "high": {
          "pass": false,
          "ms": [
            36002,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "ed31b573-a244-4877-84d1-a33af9f37fd7": {
      "name": "GPT-6 Astra",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            25080,
            11180
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            11332,
            6779
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            18799,
            9245
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            27059,
            16941
          ]
        },
        "xhigh": {
          "pass": false,
          "ms": [
            36000,
            16628,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "8837c35c-90fd-4975-a3fa-05e64c268ce1": {
      "name": "GPT-6 Luna",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            22250,
            9419
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1188,
            1945
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            9111,
            6916
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            17327,
            16749
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            24888,
            18185
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            23825,
            18436
          ]
        },
        "max": {
          "pass": false,
          "ms": [
            36000,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "81fddb7d-dac7-4376-8db6-f7d83b2860a2": {
      "name": "GPT-6 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            11777,
            8646
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1772,
            1381
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            9580,
            5480
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            12309,
            8145
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            21536,
            14340
          ]
        },
        "xhigh": {
          "pass": false,
          "ms": [
            33075,
            26130,
            36001
          ],
          "note": "over the limit (33.1 s); still thinking at 36 s"
        }
      }
    },
    "19166e5a-6423-4f51-936e-f26d2fdb4f21": {
      "name": "Grok 4.7",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36001,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": false,
          "ms": [
            36001,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "01ab10d3-ff15-45f9-ada0-8185712256e7": {
      "name": "Claude Opus 5",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36001,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            10134,
            11335
          ]
        },
        "medium": {
          "pass": false,
          "ms": [
            25969,
            33371,
            36000
          ],
          "note": "over the limit (33.4 s); still thinking at 36 s"
        }
      }
    },
    "3ab87d24-4ae7-45d0-bf9b-40183305863c": {
      "name": "Claude Sonnet 5",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36000,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            12965,
            7321
          ]
        },
        "medium": {
          "pass": false,
          "ms": [
            36001,
            27091,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "2fe04f34-853a-465c-abb7-e61ac2c046a3": {
      "name": "Claude Opus 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            10825,
            12985
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            8328,
            9938
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            12205,
            12393
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            12227,
            18730
          ]
        },
        "xhigh": {
          "pass": false,
          "ms": [
            36001,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "60c27ceb-f209-427a-a359-5da744a8c459": {
      "name": "Gemini 3.5 Flash-Lite",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            879,
            816
          ]
        },
        "minimal": {
          "pass": true,
          "ms": [
            719,
            674
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            898,
            698
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            4610,
            4908
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            17096,
            16350
          ]
        }
      }
    },
    "7ba78edd-65c2-4607-b8ed-c447bd876c2b": {
      "name": "GPT-5.6 Terra",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            12832,
            8339
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1715,
            1150
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            6299,
            6326
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            20377,
            7644
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            31866,
            8192
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            22242,
            19520
          ]
        },
        "max": {
          "pass": false,
          "ms": [
            36002,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "8c74d644-7590-4b53-9c84-5d54ee560812": {
      "name": "Claude Fable 5",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            28414,
            36002,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            9611,
            11579
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            24247,
            15628
          ]
        },
        "high": {
          "pass": false,
          "ms": [
            25203,
            36002,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "6d43b0d7-0b7f-46dc-ba8e-64c93283c80a": {
      "name": "Gemini 3.1 Flash-Lite",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            856,
            816
          ]
        },
        "minimal": {
          "pass": true,
          "ms": [
            622,
            756
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1194,
            1216
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2297,
            4126
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            14770,
            33488,
            13057
          ],
          "note": "over the limit (33.5 s)"
        }
      }
    },
    "8f126f31-538b-4f28-8e82-5a3afb15859a": {
      "name": "GPT-6.1 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            23982,
            13842
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            16841,
            9030
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            22364,
            11806
          ]
        },
        "high": {
          "pass": false,
          "ms": [
            36000,
            21532,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "03cd37d2-5baf-4c7c-bf24-bc52da9cdd97": {
      "name": "Claude Opus 4.8",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2371,
            2634
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            17736,
            26090
          ]
        },
        "medium": {
          "pass": false,
          "ms": [
            36002,
            27951,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "b655239d-3714-46d6-af40-adcf487e145c": {
      "name": "GPT-5.5",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            36001,
            31722,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "none": {
          "pass": true,
          "ms": [
            1330,
            1481
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            11678,
            10638
          ]
        },
        "medium": {
          "pass": false,
          "ms": [
            36000,
            28758,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "488d4156-c49e-4eeb-afc7-93760b7bb4f1": {
      "name": "Qwen 3.8 Flash",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1267,
            2203
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            1267,
            2203
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            36000,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "4d0e2bac-e7a0-4015-ae9f-38a8c52783cf": {
      "name": "Gemini 4 Argon",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3707,
            7103
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            4614,
            11807
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            5142,
            3848
          ]
        },
        "high": {
          "pass": false,
          "ms": [
            33251,
            36000
          ],
          "note": "over the limit (33.3 s); still thinking at 36 s"
        }
      }
    },
    "aea7b9eb-7bd2-45ac-9f7f-3ed8c2534f79": {
      "name": "Qwen 3.6-Plus",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1631,
            1347
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            1631,
            1347
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            36000,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "22293dda-c228-40a2-affa-6f53ef990725": {
      "name": "GPT-5.6 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            36001,
            11241,
            9810
          ],
          "note": "still thinking at 36 s"
        },
        "none": {
          "pass": true,
          "ms": [
            1473,
            2362
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            25535,
            7445
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            29937,
            16629
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            26983,
            18062
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            36002,
            24196,
            24364
          ],
          "note": "still thinking at 36 s"
        },
        "max": {
          "pass": false,
          "ms": [
            36002,
            36000
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "6dac4b2f-633c-4ce4-b130-6b295be2bca4": {
      "name": "Gemini 3.8 Flash",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            17182,
            17980
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            11566,
            9358
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            36001,
            17983,
            24369
          ],
          "note": "still thinking at 36 s"
        },
        "high": {
          "pass": false,
          "ms": [
            36001,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "60180614-4fe3-4b37-b2dc-220789cf19ed": {
      "name": "GPT-5.6 Luna",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            26811,
            18279
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1273,
            1121
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            16177,
            12581
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            23261,
            18474
          ]
        },
        "high": {
          "pass": false,
          "ms": [
            36002,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "97f6ba2c-675a-410a-8e02-57751a167570": {
      "name": "Claude Haiku 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            6164,
            8798
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            4508,
            5320
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            6570,
            4474
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            7351,
            14889
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            17932,
            12268
          ]
        },
        "max": {
          "pass": false,
          "ms": [
            36002,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "1bf8eb59-d094-4f09-ad1f-6e3c93edc21d": {
      "name": "Claude Sonnet 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            8957,
            11581
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            5912,
            6622
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            7491,
            8150
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            8218,
            9808
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            29913,
            25083
          ]
        },
        "max": {
          "pass": false,
          "ms": [
            36000,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    },
    "cb044218-3634-49e7-a1aa-588cf1009062": {
      "name": "Claude Fable 5.1",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            26141,
            36001,
            36002
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        },
        "low": {
          "pass": true,
          "ms": [
            16384,
            15872
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            14859,
            31780
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            23707,
            22249
          ]
        },
        "xhigh": {
          "pass": false,
          "ms": [
            36002,
            36001
          ],
          "note": "still thinking at 36 s; still thinking at 36 s"
        }
      }
    }
  },
  "poker": {
    "0f4a8e97-7ce6-4876-919a-58c5c972cc55": {
      "name": "Gemini 3.1 Pro Preview",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            6806,
            2936
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            4550,
            2925
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            3975,
            2926
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            6784,
            3706
          ]
        }
      }
    },
    "8837c35c-90fd-4975-a3fa-05e64c268ce1": {
      "name": "GPT-6 Luna",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2776,
            4297
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1952,
            1738
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2576,
            3640
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2358,
            2945
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3196,
            3096
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            3328,
            4567
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            3527,
            6414
          ]
        }
      }
    },
    "3ca6b5bb-1498-459a-8f0a-ce5458c9ed8f": {
      "name": "Qwen3.8 Max",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2936,
            2410
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            2936,
            2410
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            35650,
            36000
          ],
          "note": "over the limit (35.6 s); no reply"
        }
      }
    },
    "81fddb7d-dac7-4376-8db6-f7d83b2860a2": {
      "name": "GPT-6 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2008,
            3556
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            2597,
            1847
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1857,
            1751
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2828,
            3626
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            1818,
            3882
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            2875,
            4017
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            5592,
            8584
          ]
        }
      }
    },
    "ed31b573-a244-4877-84d1-a33af9f37fd7": {
      "name": "GPT-6 Astra",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3925,
            4105
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            7364,
            3608
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            3582,
            3427
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            5965,
            8789
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            10122,
            11939
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            16944,
            17479
          ]
        }
      }
    },
    "56986b48-64e6-44fa-b460-fc1c35aadf42": {
      "name": "Grok 4.6",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            7651,
            10990
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            3828,
            3206
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            7745,
            13293
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            7412,
            8255
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            15928,
            20702
          ]
        }
      }
    },
    "3ab87d24-4ae7-45d0-bf9b-40183305863c": {
      "name": "Claude Sonnet 5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1724,
            1868
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1492,
            1615
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            1533,
            1831
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            1722,
            2096
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            1836,
            2222
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            3562,
            18309
          ]
        }
      }
    },
    "4250c2c4-11b0-481c-bd27-75e0500a10e4": {
      "name": "Kimi K3",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            16254,
            24913
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            8039,
            5029
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            16613,
            29227
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            17445,
            15790
          ]
        }
      }
    },
    "906eda14-1219-43a1-bc04-b746cc95b05f": {
      "name": "GPT-5.5 Pro",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            21230,
            36001,
            36003
          ],
          "note": "no reply; no reply"
        }
      }
    },
    "7ba78edd-65c2-4607-b8ed-c447bd876c2b": {
      "name": "GPT-5.6 Terra",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2458,
            2231
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1632,
            1305
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1641,
            2719
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            1478,
            1489
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            1280,
            1370
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            3391,
            2875
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            4552,
            15413
          ]
        }
      }
    },
    "19166e5a-6423-4f51-936e-f26d2fdb4f21": {
      "name": "Grok 4.7",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3998,
            9459
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            4501,
            3555
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            4762,
            4789
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            7835,
            4365
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            6854,
            13846
          ]
        }
      }
    },
    "60c27ceb-f209-427a-a359-5da744a8c459": {
      "name": "Gemini 3.5 Flash-Lite",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            869,
            697
          ]
        },
        "minimal": {
          "pass": true,
          "ms": [
            703,
            846
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1554,
            1191
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2624,
            2002
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3336,
            2765
          ]
        }
      }
    },
    "6d43b0d7-0b7f-46dc-ba8e-64c93283c80a": {
      "name": "Gemini 3.1 Flash-Lite",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            814,
            855
          ]
        },
        "minimal": {
          "pass": true,
          "ms": [
            795,
            768
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1222,
            1110
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2481,
            2578
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3584,
            5798
          ]
        }
      }
    },
    "22293dda-c228-40a2-affa-6f53ef990725": {
      "name": "GPT-5.6 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2583,
            3666
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1464,
            1463
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            3650,
            3195
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2510,
            3585
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            4571,
            3319
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4092,
            4461
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            4358,
            6076
          ]
        }
      }
    },
    "b655239d-3714-46d6-af40-adcf487e145c": {
      "name": "GPT-5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            4938,
            6246
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1950,
            2159
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            3512,
            5120
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            4476,
            7488
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            5766,
            8695
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            7095,
            29602
          ]
        },
        "max": {
          "pass": false,
          "ms": [
            398,
            187
          ],
          "note": "no reply; no reply"
        }
      }
    },
    "6dac4b2f-633c-4ce4-b130-6b295be2bca4": {
      "name": "Gemini 3.8 Flash",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            5769,
            2916
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            5345,
            2065
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            3949,
            4637
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            9551,
            6085
          ]
        }
      }
    },
    "03cd37d2-5baf-4c7c-bf24-bc52da9cdd97": {
      "name": "Claude Opus 4.8",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2332,
            3667
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2149,
            1915
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2308,
            2602
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            2502,
            2586
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4491,
            8114
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            16053,
            23526
          ]
        }
      }
    },
    "60180614-4fe3-4b37-b2dc-220789cf19ed": {
      "name": "GPT-5.6 Luna",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2162,
            2820
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1414,
            1698
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1821,
            1792
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2331,
            2811
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3126,
            3697
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            3425,
            2908
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            6129,
            5937
          ]
        }
      }
    },
    "8f126f31-538b-4f28-8e82-5a3afb15859a": {
      "name": "GPT-6.1 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2991,
            3588
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2775,
            2549
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            3816,
            4536
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            6762,
            6071
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            6849,
            7881
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            11279,
            36002,
            11930
          ],
          "note": "no reply"
        }
      }
    },
    "4d0e2bac-e7a0-4015-ae9f-38a8c52783cf": {
      "name": "Gemini 4 Argon",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            9778,
            3730
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            4353,
            3295
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            11818,
            36002,
            5521
          ],
          "note": "no reply"
        },
        "high": {
          "pass": true,
          "ms": [
            8105,
            6085
          ]
        }
      }
    },
    "1bf8eb59-d094-4f09-ad1f-6e3c93edc21d": {
      "name": "Claude Sonnet 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1446,
            904,
            1977
          ],
          "note": "no reply"
        },
        "low": {
          "pass": true,
          "ms": [
            1188,
            1235,
            1762
          ],
          "note": "reply could not be read"
        },
        "medium": {
          "pass": true,
          "ms": [
            2013,
            943,
            1976
          ],
          "note": "no reply"
        },
        "high": {
          "pass": true,
          "ms": [
            3673,
            916,
            2130
          ],
          "note": "no reply"
        },
        "xhigh": {
          "pass": true,
          "ms": [
            3528,
            823,
            3134
          ],
          "note": "no reply"
        },
        "max": {
          "pass": true,
          "ms": [
            5388,
            884,
            11350
          ],
          "note": "no reply"
        }
      }
    },
    "488d4156-c49e-4eeb-afc7-93760b7bb4f1": {
      "name": "Qwen 3.8 Flash",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1598,
            2665
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            1598,
            2665
          ]
        },
        "thinking_true": {
          "pass": true,
          "ms": [
            36002,
            23793,
            30776
          ],
          "note": "no reply"
        }
      }
    },
    "cb044218-3634-49e7-a1aa-588cf1009062": {
      "name": "Claude Fable 5.1",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1780,
            1431
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1701,
            1599
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            1737,
            1684
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            2011,
            1619
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            3538,
            4609
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            3024,
            5135
          ]
        }
      }
    },
    "aea7b9eb-7bd2-45ac-9f7f-3ed8c2534f79": {
      "name": "Qwen 3.6-Plus",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1963,
            1797
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            1963,
            1797
          ]
        },
        "thinking_true": {
          "pass": true,
          "ms": [
            27136,
            36000,
            27568
          ],
          "note": "no reply"
        }
      }
    },
    "97f6ba2c-675a-410a-8e02-57751a167570": {
      "name": "Claude Haiku 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2404,
            1434
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1272,
            1162
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            1624,
            1612
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            1916,
            1866
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            2621,
            1965
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            29557,
            5711
          ]
        }
      }
    },
    "01ab10d3-ff15-45f9-ada0-8185712256e7": {
      "name": "Claude Opus 5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2247,
            2900
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1743,
            1961
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2027,
            2914
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            1977,
            3187
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            3319,
            5722
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            6167,
            8168
          ]
        }
      }
    },
    "2fe04f34-853a-465c-abb7-e61ac2c046a3": {
      "name": "Claude Opus 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2752,
            2277
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2019,
            2161
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2243,
            6445
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            5551,
            4256
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            3858,
            4002
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            9012,
            9431
          ]
        }
      }
    },
    "8c74d644-7590-4b53-9c84-5d54ee560812": {
      "name": "Claude Fable 5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            4075,
            5004
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            3144,
            3819
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            3792,
            3864
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3550,
            5654
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4146,
            5125
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            4930,
            9964
          ]
        }
      }
    }
  },
  "bridge": {
    "8837c35c-90fd-4975-a3fa-05e64c268ce1": {
      "name": "GPT-6 Luna",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2465,
            2092
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1660,
            1458
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2631,
            2433
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            3558,
            2247
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            2447,
            2892
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            2218,
            3365
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            3459,
            5379
          ]
        }
      }
    },
    "0f4a8e97-7ce6-4876-919a-58c5c972cc55": {
      "name": "Gemini 3.1 Pro Preview",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            4751,
            6623
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            3186,
            3581
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            4285,
            6236
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3741,
            7114
          ]
        }
      }
    },
    "ed31b573-a244-4877-84d1-a33af9f37fd7": {
      "name": "GPT-6 Astra",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3292,
            2266
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2455,
            2560
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2760,
            3950
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3130,
            6108
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4231,
            6110
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            5717,
            8978
          ]
        }
      }
    },
    "3ca6b5bb-1498-459a-8f0a-ce5458c9ed8f": {
      "name": "Qwen3.8 Max",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1642,
            1911
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            1642,
            1911
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            10510,
            36000,
            36001
          ],
          "note": "no reply; no reply"
        }
      }
    },
    "81fddb7d-dac7-4376-8db6-f7d83b2860a2": {
      "name": "GPT-6 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2758,
            3854
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1858,
            1448
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2380,
            3017
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            3336,
            5142
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            2817,
            3503
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4190,
            4399
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            4017,
            5312
          ]
        }
      }
    },
    "01ab10d3-ff15-45f9-ada0-8185712256e7": {
      "name": "Claude Opus 5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            7374,
            2814
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2305,
            1875
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2614,
            2126
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            4629,
            2585
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            7154,
            7496
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            8311,
            10876
          ]
        }
      }
    },
    "906eda14-1219-43a1-bc04-b746cc95b05f": {
      "name": "GPT-5.5 Pro",
      "levels": {
        "auto": {
          "pass": false,
          "ms": [
            16209,
            36000,
            36001
          ],
          "note": "no reply; no reply"
        }
      }
    },
    "56986b48-64e6-44fa-b460-fc1c35aadf42": {
      "name": "Grok 4.6",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            6815,
            16725
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2042,
            8426
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            5828,
            23939
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            7178,
            29237
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4617,
            24470
          ]
        }
      }
    },
    "3ab87d24-4ae7-45d0-bf9b-40183305863c": {
      "name": "Claude Sonnet 5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1869,
            3092
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1278,
            1419
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            1514,
            1591
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            2044,
            1976
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4657,
            2273
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            4568,
            25126
          ]
        }
      }
    },
    "4250c2c4-11b0-481c-bd27-75e0500a10e4": {
      "name": "Kimi K3",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            11809,
            26013
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            9051,
            22974
          ]
        },
        "high": {
          "pass": false,
          "ms": [
            5054,
            36001,
            33286
          ],
          "note": "no reply; over the limit (33.3 s)"
        }
      }
    },
    "2fe04f34-853a-465c-abb7-e61ac2c046a3": {
      "name": "Claude Opus 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2540,
            3202
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2229,
            2279
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            4364,
            7389
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3439,
            3654
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4331,
            4001
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            8292,
            4863
          ]
        }
      }
    },
    "19166e5a-6423-4f51-936e-f26d2fdb4f21": {
      "name": "Grok 4.7",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            11443,
            17126
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2851,
            9213
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2807,
            13209
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3271,
            17261
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4292,
            17315
          ]
        }
      }
    },
    "22293dda-c228-40a2-affa-6f53ef990725": {
      "name": "GPT-5.6 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1403,
            5166
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1430,
            1562
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1412,
            5239
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2868,
            5023
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3257,
            6104
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4322,
            8198
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            3741,
            5725
          ]
        }
      }
    },
    "60c27ceb-f209-427a-a359-5da744a8c459": {
      "name": "Gemini 3.5 Flash-Lite",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            793,
            783
          ]
        },
        "minimal": {
          "pass": true,
          "ms": [
            667,
            733
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            798,
            800
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            1699,
            3017
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            2586,
            3708
          ]
        }
      }
    },
    "8c74d644-7590-4b53-9c84-5d54ee560812": {
      "name": "Claude Fable 5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3459,
            4802
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            3091,
            2867
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            3206,
            4158
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3166,
            4806
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            3477,
            8776
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            4946,
            25773
          ]
        }
      }
    },
    "b655239d-3714-46d6-af40-adcf487e145c": {
      "name": "GPT-5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3392,
            8737
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1543,
            1901
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            3398,
            6298
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            4355,
            8756
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            4259,
            8616
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4014,
            12973
          ]
        },
        "max": {
          "pass": false,
          "ms": [
            170,
            178
          ],
          "note": "no reply; no reply"
        }
      }
    },
    "7ba78edd-65c2-4607-b8ed-c447bd876c2b": {
      "name": "GPT-5.6 Terra",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3092,
            2059
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1168,
            1401
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1860,
            2994
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2277,
            2988
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            2049,
            2484
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            2053,
            9911
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            2499,
            36002,
            8985
          ],
          "note": "no reply"
        }
      }
    },
    "8f126f31-538b-4f28-8e82-5a3afb15859a": {
      "name": "GPT-6.1 Sol",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2399,
            2457
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            2508,
            2004
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2530,
            3326
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            8931,
            4372
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4673,
            5730
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            5148,
            9189
          ]
        }
      }
    },
    "6d43b0d7-0b7f-46dc-ba8e-64c93283c80a": {
      "name": "Gemini 3.1 Flash-Lite",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1148,
            954
          ]
        },
        "minimal": {
          "pass": true,
          "ms": [
            901,
            915
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1349,
            1200
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2750,
            1986
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            3716,
            5788
          ]
        }
      }
    },
    "6dac4b2f-633c-4ce4-b130-6b295be2bca4": {
      "name": "Gemini 3.8 Flash",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2899,
            3857
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            3278,
            2501
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            3534,
            3493
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            6836,
            8807
          ]
        }
      }
    },
    "03cd37d2-5baf-4c7c-bf24-bc52da9cdd97": {
      "name": "Claude Opus 4.8",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2525,
            2242
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1667,
            2016
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2333,
            2633
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            1910,
            3132
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4445,
            4585
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            4585,
            8669
          ]
        }
      }
    },
    "4d0e2bac-e7a0-4015-ae9f-38a8c52783cf": {
      "name": "Gemini 4 Argon",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3194,
            5046
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            3415,
            4211
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            3926,
            3512
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            10577,
            9814
          ]
        }
      }
    },
    "60180614-4fe3-4b37-b2dc-220789cf19ed": {
      "name": "GPT-5.6 Luna",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            3720,
            6318
          ]
        },
        "none": {
          "pass": true,
          "ms": [
            1394,
            1901
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1907,
            6507
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            6738,
            2517
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            2093,
            3049
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            2609,
            3425
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            3535,
            5850
          ]
        }
      }
    },
    "cb044218-3634-49e7-a1aa-588cf1009062": {
      "name": "Claude Fable 5.1",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1814,
            1990
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1819,
            1738
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            1908,
            1786
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            1766,
            1887
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            3003,
            3281
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            3678,
            8558
          ]
        }
      }
    },
    "1bf8eb59-d094-4f09-ad1f-6e3c93edc21d": {
      "name": "Claude Sonnet 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1853,
            3878
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1471,
            1882
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            4581,
            1837
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            2505,
            3105
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            4268,
            5504
          ]
        },
        "max": {
          "pass": true,
          "ms": [
            6184,
            17128
          ]
        }
      }
    },
    "488d4156-c49e-4eeb-afc7-93760b7bb4f1": {
      "name": "Qwen 3.8 Flash",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            981,
            1428
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            981,
            1428
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            24722,
            36000,
            36001
          ],
          "note": "no reply; no reply"
        }
      }
    },
    "aea7b9eb-7bd2-45ac-9f7f-3ed8c2534f79": {
      "name": "Qwen 3.6-Plus",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            1320,
            1455
          ]
        },
        "thinking_false": {
          "pass": true,
          "ms": [
            1320,
            1455
          ]
        },
        "thinking_true": {
          "pass": false,
          "ms": [
            21610,
            36000,
            36006
          ],
          "note": "no reply; no reply"
        }
      }
    },
    "97f6ba2c-675a-410a-8e02-57751a167570": {
      "name": "Claude Haiku 5.5",
      "levels": {
        "auto": {
          "pass": true,
          "ms": [
            2298,
            2446
          ]
        },
        "low": {
          "pass": true,
          "ms": [
            1423,
            3544
          ]
        },
        "medium": {
          "pass": true,
          "ms": [
            2425,
            2733
          ]
        },
        "high": {
          "pass": true,
          "ms": [
            5391,
            3639
          ]
        },
        "xhigh": {
          "pass": true,
          "ms": [
            9081,
            3118
          ]
        },
        "max": {
          "pass": false,
          "ms": [
            5240,
            36020,
            36017
          ],
          "note": "no reply; no reply"
        }
      }
    }
  }
} as Record<string, Record<string, { name: string; levels: Record<string, { pass: boolean; ms: number[]; note?: string }> }>>,
}
