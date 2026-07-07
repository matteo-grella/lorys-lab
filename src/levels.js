/* Lory's Lab — level campaign (24 levels). Auto-verified by test/verify.mjs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LoryLevels = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return [
   {
    "title": "Roll to the Bowl",
    "goalType": "catch",
    "goalText": "Help the berry roll all the way into Lory's bowl!",
    "teaches": "plank: a tilted plank makes a ball roll downhill",
    "fixed": [
     {
      "type": "shelf",
      "x": 260,
      "y": 240,
      "w": 320,
      "h": 40,
      "angle": 12
     },
     {
      "type": "berry",
      "x": 140,
      "y": 178
     },
     {
      "type": "bowl",
      "x": 690,
      "y": 655
     }
    ],
    "tray": [
     {
      "type": "plank",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "plank",
      "x": 532,
      "y": 590,
      "angle": 15
     }
    ],
    "sparkles": [
     {
      "x": 300,
      "y": 212
     },
     {
      "x": 460,
      "y": 380
     },
     {
      "x": 575,
      "y": 566
     }
    ],
    "hintText": "The berry falls off the shelf right there... put your plank under it, tilted toward my bowl, and it will keep on rolling!"
   },
   {
    "title": "Boing! Over the Wall",
    "goalType": "catch",
    "goalText": "Bounce the berry over the wall and into the bowl!",
    "teaches": "trampoline: launches a falling ball back up high",
    "fixed": [
     {
      "type": "shelf",
      "x": 280,
      "y": 220,
      "w": 360,
      "h": 40,
      "angle": 22
     },
     {
      "type": "berry",
      "x": 130,
      "y": 121
     },
     {
      "type": "wall",
      "x": 700,
      "y": 595,
      "w": 40,
      "h": 190
     },
     {
      "type": "wall",
      "x": 890,
      "y": 385,
      "w": 40,
      "h": 610
     },
     {
      "type": "bowl",
      "x": 795,
      "y": 655
     }
    ],
    "tray": [
     {
      "type": "trampoline",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "trampoline",
      "x": 590,
      "y": 678
     }
    ],
    "sparkles": [
     {
      "x": 545,
      "y": 436
     },
     {
      "x": 682,
      "y": 312
     },
     {
      "x": 740,
      "y": 495
     }
    ],
    "hintText": "See where the berry plops onto the floor? Put the trampoline right on that spot and it will bounce sky-high over the wall!"
   },
   {
    "title": "Heavy Helper",
    "goalType": "bell",
    "goalText": "Drop the heavy marble to fling the berry up to the bell!",
    "teaches": "seesaw + marble: a heavy drop on one end flings a light thing up",
    "fixed": [
     {
      "type": "seesaw",
      "x": 620,
      "y": 590
     },
     {
      "type": "berry",
      "x": 525,
      "y": 565
     },
     {
      "type": "shelf",
      "x": 440,
      "y": 455,
      "w": 160,
      "h": 40
     },
     {
      "type": "bell",
      "x": 440,
      "y": 525
     }
    ],
    "tray": [
     {
      "type": "ball_marble",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "ball_marble",
      "x": 700,
      "y": 270
     }
    ],
    "sparkles": [
     {
      "x": 700,
      "y": 420
     },
     {
      "x": 498,
      "y": 578
     },
     {
      "x": 473,
      "y": 542
     }
    ],
    "hintText": "The berry sits on one end of my seesaw. Hold the marble WAY up high over the other end and let it drop. Boing... DING!"
   },
   {
    "title": "Windy Day",
    "goalType": "bell",
    "goalText": "Blow the beach ball off the shelf to ring the bell!",
    "teaches": "fan: steady wind pushes light things like beach balls",
    "fixed": [
     {
      "type": "shelf",
      "x": 360,
      "y": 480,
      "w": 280,
      "h": 40
     },
     {
      "type": "ball_beach",
      "x": 400,
      "y": 432
     },
     {
      "type": "bell",
      "x": 690,
      "y": 660
     }
    ],
    "tray": [
     {
      "type": "fan",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "fan",
      "x": 270,
      "y": 432,
      "dir": "right"
     }
    ],
    "sparkles": [
     {
      "x": 520,
      "y": 430
     },
     {
      "x": 590,
      "y": 520
     },
     {
      "x": 660,
      "y": 600
     }
    ],
    "hintText": "The beach ball is so light! Set the fan on the shelf behind it, blowing toward the bell. Whooooosh!"
   },
   {
    "title": "Domino Parade",
    "goalType": "catch",
    "goalText": "Fill the gap so the dominoes push the berry off the table into the bowl!",
    "teaches": "domino: dominoes topple in a chain and can push a berry",
    "fixed": [
     {
      "type": "shelf",
      "x": 250,
      "y": 360,
      "w": 360,
      "h": 24,
      "angle": 26
     },
     {
      "type": "ball_marble",
      "x": 115,
      "y": 262
     },
     {
      "type": "shelf",
      "x": 543,
      "y": 520,
      "w": 178,
      "h": 40
     },
     {
      "type": "domino",
      "x": 465,
      "y": 472
     },
     {
      "type": "domino",
      "x": 499,
      "y": 472
     },
     {
      "type": "trampoline",
      "x": 386,
      "y": 678
     },
     {
      "type": "berry",
      "x": 626,
      "y": 483
     },
     {
      "type": "bowl",
      "x": 700,
      "y": 655
     }
    ],
    "tray": [
     {
      "type": "domino",
      "count": 3
     }
    ],
    "solution": [
     {
      "type": "domino",
      "x": 527,
      "y": 472
     },
     {
      "type": "domino",
      "x": 557,
      "y": 472
     },
     {
      "type": "domino",
      "x": 587,
      "y": 472
     }
    ],
    "sparkles": [
     {
      "x": 265,
      "y": 334
     },
     {
      "x": 464,
      "y": 437
     },
     {
      "x": 649,
      "y": 550
     }
    ],
    "hintText": "Three dominoes are missing from my parade! Stand them in the gap, nice and close, so the last one can nudge the berry off the table."
   },
   {
    "title": "Berry Express",
    "goalType": "catch",
    "goalText": "Catch the berry on the belt and ride it over the wall into the bowl!",
    "teaches": "conveyor: a moving belt carries things sideways",
    "fixed": [
     {
      "type": "shelf",
      "x": 240,
      "y": 200,
      "w": 280,
      "h": 40,
      "angle": 12
     },
     {
      "type": "berry",
      "x": 130,
      "y": 140
     },
     {
      "type": "wall",
      "x": 490,
      "y": 565,
      "w": 40,
      "h": 250
     },
     {
      "type": "bowl",
      "x": 640,
      "y": 655
     }
    ],
    "tray": [
     {
      "type": "conveyor",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "conveyor",
      "x": 470,
      "y": 380,
      "dir": "right"
     }
    ],
    "sparkles": [
     {
      "x": 300,
      "y": 170
     },
     {
      "x": 500,
      "y": 345
     },
     {
      "x": 610,
      "y": 470
     }
    ],
    "hintText": "Catch the falling berry on my moving belt, arrows pointing right \u2014 it will ride straight over that wall. All aboard the Berry Express!"
   },
   {
    "title": "Bumper Boing",
    "goalType": "bell",
    "goalText": "Bounce the beach ball off the bumper to ring the high-up bell!",
    "teaches": "bumper: super bouncy, bounces balls much higher than the floor does",
    "fixed": [
     {
      "type": "shelf",
      "x": 250,
      "y": 320,
      "w": 280,
      "h": 40,
      "angle": 12
     },
     {
      "type": "ball_beach",
      "x": 140,
      "y": 249
     },
     {
      "type": "bucket",
      "x": 460,
      "y": 645
     },
     {
      "type": "shelf",
      "x": 540,
      "y": 370,
      "w": 120,
      "h": 40
     },
     {
      "type": "bell",
      "x": 540,
      "y": 480
     }
    ],
    "tray": [
     {
      "type": "bumper",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "bumper",
      "x": 435,
      "y": 560
     }
    ],
    "sparkles": [
     {
      "x": 300,
      "y": 285
     },
     {
      "x": 440,
      "y": 440
     },
     {
      "x": 510,
      "y": 460
     }
    ],
    "hintText": "Watch where the ball falls off the ramp, then float the bumper right in its path above the bucket. Bumpers are SO springy the ball will boing sideways up to the bell!"
   },
   {
    "title": "Wake-up Call",
    "goalType": "bell",
    "goalText": "Wake the sleepy magnet to pull the marble to the bell!",
    "teaches": "magnet: a bump wakes it, then it pulls metal marbles",
    "fixed": [
     {
      "type": "shelf",
      "x": 340,
      "y": 460,
      "w": 240,
      "h": 24
     },
     {
      "type": "ball_marble",
      "x": 420,
      "y": 429
     },
     {
      "type": "bell",
      "x": 560,
      "y": 430
     },
     {
      "type": "shelf",
      "x": 720,
      "y": 500,
      "w": 140,
      "h": 24
     },
     {
      "type": "magnet",
      "x": 720,
      "y": 460
     }
    ],
    "tray": [
     {
      "type": "ball_beach",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "ball_beach",
      "x": 720,
      "y": 250
     }
    ],
    "sparkles": [
     {
      "x": 720,
      "y": 320
     },
     {
      "x": 460,
      "y": 431
     },
     {
      "x": 503,
      "y": 441
     }
    ],
    "hintText": "Magnets snooze until something bumps them! Drop the beach ball right on top of the magnet \u2014 then watch it grab the marble. CLUNK!"
   },
   {
    "title": "Pop Goes Bloopy",
    "goalType": "pop",
    "goalText": "Steer Bloopy the balloon into the spiky pokers \u2014 POP!",
    "teaches": "balloons float up, fans steer them, spikes pop them",
    "fixed": [
     {
      "type": "balloon_goal",
      "x": 430,
      "y": 300
     },
     {
      "type": "shelf",
      "x": 620,
      "y": 240,
      "w": 360,
      "h": 40
     },
     {
      "type": "spikes",
      "x": 530,
      "y": 290,
      "angle": 180
     },
     {
      "type": "spikes",
      "x": 590,
      "y": 290,
      "angle": 180
     },
     {
      "type": "spikes",
      "x": 650,
      "y": 290,
      "angle": 180
     },
     {
      "type": "spikes",
      "x": 710,
      "y": 290,
      "angle": 180
     }
    ],
    "tray": [
     {
      "type": "fan",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "fan",
      "x": 270,
      "y": 300,
      "dir": "right"
     }
    ],
    "sparkles": [
     {
      "x": 444,
      "y": 298
     },
     {
      "x": 462,
      "y": 301
     },
     {
      "x": 477,
      "y": 308
     }
    ],
    "hintText": "Bloopy's string keeps him bobbing right beside the spiky pokers. Set your fan on his left blowing right, and the breeze will swing him into them - POP!"
   },
   {
    "title": "Funnel Fun",
    "goalType": "catch",
    "goalText": "Stop the flying berry with the bucket so it drops into the bowl!",
    "teaches": "bucket: a big sturdy catcher \u2014 its tall side stops a flying ball so it falls straight down",
    "fixed": [
     {
      "type": "shelf",
      "x": 240,
      "y": 220,
      "w": 320,
      "h": 40,
      "angle": 25
     },
     {
      "type": "berry",
      "x": 105,
      "y": 130
     },
     {
      "type": "bowl",
      "x": 410,
      "y": 655
     }
    ],
    "tray": [
     {
      "type": "bucket",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "bucket",
      "x": 512,
      "y": 290
     }
    ],
    "sparkles": [
     {
      "x": 280,
      "y": 199
     },
     {
      "x": 431,
      "y": 289
     },
     {
      "x": 432,
      "y": 480
     }
    ],
    "hintText": "That berry zooms off the ramp all wobbly! Park my bucket in its path up high \u2014 the berry bonks its side and drops straight down into the bowl."
   },
   {
    "title": "Jump the Big Wall",
    "goalType": "catch",
    "goalText": "Bounce the berry OVER the big wall, then slide it into the bowl!",
    "teaches": "combo: trampoline to clear a wall + plank to land the catch",
    "fixed": [
     {
      "type": "shelf",
      "x": 260,
      "y": 300,
      "w": 240,
      "h": 24,
      "angle": 26
     },
     {
      "type": "berry",
      "x": 180,
      "y": 231
     },
     {
      "type": "wall",
      "x": 580,
      "y": 590,
      "w": 40,
      "h": 200
     },
     {
      "type": "bowl",
      "x": 850,
      "y": 655
     }
    ],
    "tray": [
     {
      "type": "trampoline",
      "count": 1
     },
     {
      "type": "plank",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "trampoline",
      "x": 495,
      "y": 678
     },
     {
      "type": "plank",
      "x": 690,
      "y": 590,
      "angle": 12
     }
    ],
    "sparkles": [
     {
      "x": 522,
      "y": 415
     },
     {
      "x": 565,
      "y": 337
     },
     {
      "x": 816,
      "y": 601
     }
    ],
    "hintText": "Trampoline BEFORE the wall to jump it, tilted plank AFTER the wall to catch the landing and slide home. Ta-da!"
   },
   {
    "title": "Beach Ball Bowling",
    "goalType": "catch",
    "goalText": "The fan can't push the berry... but it CAN push something that can!",
    "teaches": "insight: wind cannot move a berry, but a wind-blown beach ball can",
    "fixed": [
     {
      "type": "shelf",
      "x": 620,
      "y": 300,
      "w": 300,
      "h": 40
     },
     {
      "type": "berry",
      "x": 700,
      "y": 263
     },
     {
      "type": "bowl",
      "x": 890,
      "y": 655
     }
    ],
    "tray": [
     {
      "type": "fan",
      "count": 1
     },
     {
      "type": "ball_beach",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "ball_beach",
      "x": 520,
      "y": 252
     },
     {
      "type": "fan",
      "x": 395,
      "y": 252,
      "dir": "right"
     }
    ],
    "sparkles": [
     {
      "x": 600,
      "y": 235
     },
     {
      "x": 760,
      "y": 250
     },
     {
      "x": 860,
      "y": 440
     }
    ],
    "hintText": "My fan is too gentle to budge a berry \u2014 but beach balls LOVE wind! Set the ball on the shelf and bowl the berry right off the edge."
   },
   {
    "title": "Double Bubble Pop",
    "goalType": "pop",
    "goalText": "Blow BOTH balloons along the ceiling into the middle spikes!",
    "teaches": "combo: two fans working from both sides at once",
    "fixed": [
     {
      "type": "shelf",
      "x": 640,
      "y": 100,
      "w": 1200,
      "h": 40
     },
     {
      "type": "spikes",
      "x": 615,
      "y": 150,
      "angle": 180
     },
     {
      "type": "spikes",
      "x": 675,
      "y": 150,
      "angle": 180
     },
     {
      "type": "balloon_goal",
      "x": 500,
      "y": 160
     },
     {
      "type": "balloon_goal",
      "x": 795,
      "y": 160
     },
     {
      "type": "shelf",
      "x": 420,
      "y": 250,
      "w": 80,
      "h": 16
     },
     {
      "type": "ball_beach",
      "x": 452,
      "y": 213
     }
    ],
    "tray": [
     {
      "type": "fan",
      "count": 2
     }
    ],
    "solution": [
     {
      "type": "fan",
      "x": 330,
      "y": 160,
      "dir": "right"
     },
     {
      "type": "fan",
      "x": 1005,
      "y": 160,
      "dir": "left"
     }
    ],
    "sparkles": [
     {
      "x": 500,
      "y": 230
     },
     {
      "x": 525,
      "y": 260
     },
     {
      "x": 550,
      "y": 295
     }
    ],
    "hintText": "Two balloons, one spiky spot in the middle! Point your fans toward each other and the balloons will slide along the ceiling till... POP-POP!"
   },
   {
    "title": "The Long Way Home",
    "goalType": "catch",
    "goalText": "Carry the berry LEFT on the belt, then bounce it over the wall into the bowl!",
    "teaches": "combo: choosing belt direction + bouncing over a wall, all leftward",
    "fixed": [
     {
      "type": "shelf",
      "x": 930,
      "y": 390,
      "w": 260,
      "h": 40,
      "angle": -10
     },
     {
      "type": "berry",
      "x": 1030,
      "y": 335
     },
     {
      "type": "wall",
      "x": 530,
      "y": 625,
      "w": 24,
      "h": 130
     },
     {
      "type": "wall",
      "x": 330,
      "y": 475,
      "w": 40,
      "h": 430
     },
     {
      "type": "bowl",
      "x": 445,
      "y": 655
     }
    ],
    "tray": [
     {
      "type": "conveyor",
      "count": 1
     },
     {
      "type": "trampoline",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "conveyor",
      "x": 750,
      "y": 450,
      "dir": "left"
     },
     {
      "type": "trampoline",
      "x": 605,
      "y": 678
     }
    ],
    "sparkles": [
     {
      "x": 870,
      "y": 363
     },
     {
      "x": 700,
      "y": 421
     },
     {
      "x": 525,
      "y": 435
     }
    ],
    "hintText": "Everything goes LEFT today! Point the belt's arrows toward my bowl, and put the trampoline between the belt and the wall."
   },
   {
    "title": "The Magnet Crane",
    "goalType": "catch",
    "goalText": "Wake the magnet, catch the falling marble, fling the berry!",
    "teaches": "combo: magnet release + seesaw fling",
    "fixed": [
     {
      "type": "shelf",
      "x": 560,
      "y": 430,
      "w": 100,
      "h": 24
     },
     {
      "type": "ball_marble",
      "x": 560,
      "y": 399
     },
     {
      "type": "magnet",
      "x": 700,
      "y": 300
     },
     {
      "type": "berry",
      "x": 857,
      "y": 534
     },
     {
      "type": "wall",
      "x": 895,
      "y": 629,
      "w": 40,
      "h": 122
     },
     {
      "type": "bowl",
      "x": 650,
      "y": 655
     }
    ],
    "tray": [
     {
      "type": "seesaw",
      "count": 1
     },
     {
      "type": "ball_beach",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "seesaw",
      "x": 782,
      "y": 560
     },
     {
      "type": "ball_beach",
      "x": 712,
      "y": 160
     }
    ],
    "sparkles": [
     {
      "x": 652,
      "y": 373
     },
     {
      "x": 701,
      "y": 470
     },
     {
      "x": 665,
      "y": 600
     }
    ],
    "hintText": "Put the seesaw under the magnet \u2014 when the magnet gets tired it DROPS the marble! Then wake the magnet with the beach ball. Whee!"
   },
   {
    "title": "The Great Berry Machine",
    "goalType": "catch",
    "goalText": "Build the whole chain: dominoes tap the berry, your plank slides it down, and the trampoline bounces it into the bowl!",
    "teaches": "grand finale: marble starter + domino chain + plank ramp + trampoline in one machine",
    "fixed": [
     {
      "type": "plank",
      "x": 210,
      "y": 182,
      "angle": 18
     },
     {
      "type": "ball_marble",
      "x": 145,
      "y": 142
     },
     {
      "type": "shelf",
      "x": 320,
      "y": 260,
      "w": 140,
      "h": 40
     },
     {
      "type": "domino",
      "x": 300,
      "y": 211
     },
     {
      "type": "shelf",
      "x": 420,
      "y": 260,
      "w": 28,
      "h": 40
     },
     {
      "type": "berry",
      "x": 429,
      "y": 222
     },
     {
      "type": "bowl",
      "x": 790,
      "y": 655
     }
    ],
    "tray": [
     {
      "type": "domino",
      "count": 2
     },
     {
      "type": "trampoline",
      "count": 1
     },
     {
      "type": "plank",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "domino",
      "x": 334,
      "y": 211
     },
     {
      "type": "domino",
      "x": 368,
      "y": 211
     },
     {
      "type": "trampoline",
      "x": 655,
      "y": 678
     },
     {
      "type": "plank",
      "x": 496,
      "y": 330,
      "angle": 18
     }
    ],
    "sparkles": [
     {
      "x": 250,
      "y": 170
     },
     {
      "x": 516,
      "y": 309
     },
     {
      "x": 740,
      "y": 520
     }
    ],
    "hintText": "Follow the story! My marble tips the first domino - fill the gap so the chain reaches the berry. Then your tilted plank slides it down, and the trampoline bounces it sky-high into the bowl!"
   },
   {
    "title": "Skip, Skip, Splash!",
    "goalType": "catch",
    "goalText": "Skip the berry across the lab and splash into the bowl!",
    "teaches": "Trampolines keep sideways speed: a fast-flying berry skips across them like a stone on water instead of stopping.",
    "fixed": [
     {
      "type": "seesaw",
      "x": 300,
      "y": 560
     },
     {
      "type": "berry",
      "x": 395,
      "y": 535
     },
     {
      "type": "wall",
      "x": 814,
      "y": 560,
      "w": 24,
      "h": 260
     },
     {
      "type": "bowl",
      "x": 755,
      "y": 676
     }
    ],
    "tray": [
     {
      "type": "ball_marble",
      "count": 1
     },
     {
      "type": "trampoline",
      "count": 2
     }
    ],
    "solution": [
     {
      "type": "ball_marble",
      "x": 230,
      "y": 250
     },
     {
      "type": "trampoline",
      "x": 530,
      "y": 610
     },
     {
      "type": "trampoline",
      "x": 645,
      "y": 610
     }
    ],
    "sparkles": [
     {
      "x": 442,
      "y": 522
     },
     {
      "x": 605,
      "y": 479
     },
     {
      "x": 699,
      "y": 500
     }
    ],
    "hintText": "Drop the marble from way up high onto the seesaw's empty end and my berry ZOOMS off sideways! It's going too fast to stop \u2014 so don't stop it! Lay the two trampolines side by side just above the floor where it comes down, and it'll skip... skip... SKIP along, bonk off the wall, and SPLASH into the bowl!"
   },
   {
    "title": "Plink! Plonk! Plop!",
    "goalType": "catch",
    "goalText": "Bounce the berry into the bowl \u2014 plink, plonk, PLOP!",
    "teaches": "Bumper double-bounce steering: each bumper bounce nudges the berry further sideways, like a giant pinball.",
    "fixed": [
     {
      "type": "shelf",
      "x": 180,
      "y": 150,
      "w": 160,
      "h": 16,
      "angle": 12
     },
     {
      "type": "berry",
      "x": 115,
      "y": 111
     },
     {
      "type": "shelf",
      "x": 470,
      "y": 475,
      "w": 280,
      "h": 16,
      "angle": 12
     },
     {
      "type": "wall",
      "x": 660,
      "y": 520,
      "w": 24,
      "h": 100
     },
     {
      "type": "wall",
      "x": 787,
      "y": 590,
      "w": 24,
      "h": 200
     },
     {
      "type": "bowl",
      "x": 710,
      "y": 676
     }
    ],
    "tray": [
     {
      "type": "bumper",
      "count": 2
     }
    ],
    "solution": [
     {
      "type": "bumper",
      "x": 288,
      "y": 420
     },
     {
      "type": "bumper",
      "x": 601,
      "y": 624
     }
    ],
    "sparkles": [
     {
      "x": 300,
      "y": 300
     },
     {
      "x": 520,
      "y": 461
     },
     {
      "x": 629,
      "y": 512
     }
    ],
    "hintText": "My berry rolls off the shelf and just goes splat! Catch it on a bumper a tiny bit LEFT of where it falls, so it boings off to the right onto the long ramp. It rolls down to the little wall and drips off \u2014 put your second bumper a smidge LEFT of the drip, and PLOP, straight into the bowl! The tall wall catches any wild bounces."
   },
   {
    "title": "The Beach Ball Elevator",
    "goalType": "bell",
    "goalText": "Ring the bell on the high shelf!",
    "teaches": "An up-fan is an elevator for beach balls; a second sideways fan at the top hands the ball off toward the target.",
    "fixed": [
     {
      "type": "wall",
      "x": 150,
      "y": 620,
      "w": 20,
      "h": 140
     },
     {
      "type": "wall",
      "x": 260,
      "y": 620,
      "w": 20,
      "h": 140
     },
     {
      "type": "shelf",
      "x": 470,
      "y": 530,
      "w": 120,
      "h": 16,
      "angle": 0
     },
     {
      "type": "bell",
      "x": 470,
      "y": 492
     }
    ],
    "tray": [
     {
      "type": "ball_beach",
      "count": 1
     },
     {
      "type": "fan",
      "count": 2
     }
    ],
    "solution": [
     {
      "type": "fan",
      "x": 205,
      "y": 650,
      "dir": "up"
     },
     {
      "type": "ball_beach",
      "x": 205,
      "y": 580
     },
     {
      "type": "fan",
      "x": 100,
      "y": 470,
      "dir": "right"
     }
    ],
    "sparkles": [
     {
      "x": 210,
      "y": 540
     },
     {
      "x": 280,
      "y": 495
     },
     {
      "x": 375,
      "y": 478
     }
    ],
    "hintText": "Fans can't budge my berry, but a beach ball LOVES the wind! Point one fan straight up inside the little tube \u2014 whoosh, an elevator! Then set the second fan on the left, blowing right just above the tube, so the ball whooshes sideways at the top of its ride. Ding-a-ling!"
   },
   {
    "title": "Bloopy's Zigzag Climb",
    "goalType": "pop",
    "goalText": "Steer your balloon up and around the ledges to boop Bloopy into the hanging cactus!",
    "teaches": "A loose balloon rises all by itself (1-2px/f) - fans don't lift it, they STEER it. Ledges are balloon traps; alternate left and right winds to slalom it up.",
    "fixed": [
     {
      "type": "shelf",
      "x": 400,
      "y": 150,
      "w": 160,
      "h": 20,
      "angle": 0
     },
     {
      "type": "spikes",
      "x": 420,
      "y": 192,
      "angle": 180
     },
     {
      "type": "balloon_goal",
      "x": 350,
      "y": 215
     },
     {
      "type": "shelf",
      "x": 510,
      "y": 280,
      "w": 240,
      "h": 20,
      "angle": 0
     },
     {
      "type": "shelf",
      "x": 290,
      "y": 480,
      "w": 240,
      "h": 20,
      "angle": 0
     },
     {
      "type": "wall",
      "x": 310,
      "y": 230,
      "w": 20,
      "h": 180
     }
    ],
    "tray": [
     {
      "type": "balloon",
      "count": 1
     },
     {
      "type": "fan",
      "count": 2
     }
    ],
    "solution": [
     {
      "type": "balloon",
      "x": 300,
      "y": 640
     },
     {
      "type": "fan",
      "x": 120,
      "y": 540,
      "dir": "right"
     },
     {
      "type": "fan",
      "x": 660,
      "y": 330,
      "dir": "left"
     }
    ],
    "sparkles": [
     {
      "x": 344,
      "y": 548
     },
     {
      "x": 500,
      "y": 320
     },
     {
      "x": 350,
      "y": 320
     }
    ],
    "hintText": "Bloopy waits under the prickles! Your balloon floats up on its own - fans only point the way. When a ledge stops it, sideways wind slides it past. Zig right, zag left, boop!"
   },
   {
    "title": "The Domino Alarm Clock",
    "goalType": "bell",
    "goalText": "Ring the bell under the sleepy magnet!",
    "teaches": "A domino tumbling off a shelf edge can WAKE a sleeping magnet - which then grabs the very marble that started the chain and swings it up to ring the bell.",
    "fixed": [
     {
      "type": "shelf",
      "x": 432,
      "y": 214,
      "w": 160,
      "h": 16,
      "angle": 44
     },
     {
      "type": "shelf",
      "x": 571,
      "y": 320,
      "w": 130,
      "h": 16,
      "angle": 0
     },
     {
      "type": "domino",
      "x": 514,
      "y": 284
     },
     {
      "type": "domino",
      "x": 548,
      "y": 284
     },
     {
      "type": "domino",
      "x": 582,
      "y": 284
     },
     {
      "type": "domino",
      "x": 616,
      "y": 284
     },
     {
      "type": "magnet",
      "x": 640,
      "y": 500
     },
     {
      "type": "bell",
      "x": 640,
      "y": 625
     }
    ],
    "tray": [
     {
      "type": "plank",
      "count": 1
     },
     {
      "type": "ball_marble",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "plank",
      "x": 296,
      "y": 134,
      "angle": 8
     },
     {
      "type": "ball_marble",
      "x": 306,
      "y": 102
     }
    ],
    "sparkles": [
     {
      "x": 348,
      "y": 114
     },
     {
      "x": 456,
      "y": 432
     },
     {
      "x": 494,
      "y": 664
     }
    ],
    "hintText": "Ssh - the magnet under the ledge is snoozing! Lay your plank up top so the marble can roll onto the steep slide and smack the tall domino face-first. The marble bounces off and plops all the way down to the floor - but up above it's tip-tap-tumble! The last domino dives off the shelf and BONKS the magnet awake - just in time to grab your marble off the floor and swing it up to ring the bell!"
   },
   {
    "title": "Magnet Leapfrog",
    "goalType": "bell",
    "goalText": "Carry the marble all the way home and ring the doorbell!",
    "teaches": "Magnet relay: a woken magnet carries a marble partway, and the rolling marble can bump a second magnet awake all by itself.",
    "fixed": [
     {
      "type": "magnet",
      "x": 330,
      "y": 150
     },
     {
      "type": "shelf",
      "x": 600,
      "y": 300,
      "w": 80,
      "h": 16,
      "angle": 0
     },
     {
      "type": "ball_marble",
      "x": 600,
      "y": 274
     },
     {
      "type": "shelf",
      "x": 400,
      "y": 350,
      "w": 200,
      "h": 16,
      "angle": 30
     },
     {
      "type": "wall",
      "x": 617,
      "y": 393,
      "w": 24,
      "h": 165
     },
     {
      "type": "bell",
      "x": 572,
      "y": 640
     }
    ],
    "tray": [
     {
      "type": "ball_beach",
      "count": 1
     },
     {
      "type": "magnet",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "ball_beach",
      "x": 330,
      "y": 85
     },
     {
      "type": "magnet",
      "x": 563,
      "y": 392
     }
    ],
    "sparkles": [
     {
      "x": 480,
      "y": 268
     },
     {
      "x": 376,
      "y": 300
     },
     {
      "x": 464,
      "y": 357
     }
    ],
    "hintText": "Both magnets start out snoozing! Drop the bouncy ball on the first one to wake it \u2014 it grabs the marble, gets tired, and lets go. The marble lands on the steep ramp and rolls fast! Park YOUR magnet just past the ramp, beside the wall of the house: the speeding marble bumps it awake, and it plays the same trick \u2014 grab, snooze, drop... ding-dong, right onto the doorbell!"
   },
   {
    "title": "The Great Balloon Blast",
    "goalType": "pop",
    "goalText": "Fling the beach ball sideways and pop the balloon hiding under its awning!",
    "teaches": "A seesaw throws sideways, not up (flat and far, only ~100px high) - so aim it at a target off to the side. Light beach balls make the best ammo, and a floating balloon pops from any fast hit, not just cactus.",
    "fixed": [
     {
      "type": "shelf",
      "x": 975,
      "y": 445,
      "w": 220,
      "h": 20,
      "angle": 0
     },
     {
      "type": "balloon_goal",
      "x": 975,
      "y": 570
     }
    ],
    "tray": [
     {
      "type": "seesaw",
      "count": 1
     },
     {
      "type": "ball_marble",
      "count": 1
     },
     {
      "type": "ball_beach",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "ball_marble",
      "x": 655,
      "y": 245
     },
     {
      "type": "seesaw",
      "x": 750,
      "y": 560
     },
     {
      "type": "ball_beach",
      "x": 845,
      "y": 516
     }
    ],
    "sparkles": [
     {
      "x": 655,
      "y": 420
     },
     {
      "x": 874,
      "y": 548
     },
     {
      "x": 905,
      "y": 534
     }
    ],
    "hintText": "Heavy marble DOWN, beach ball AWAY! That awning blocks anything falling from above - but my seesaw throws far and FLAT, straight in under the roof. Drop the marble from way up high onto the near end. KER-SPLAT-POP!"
   },
   {
    "title": "Right on the Dot!",
    "goalType": "bell",
    "goalText": "Thread the marble between the cacti and ring the bell - bullseye!",
    "teaches": "The finale aha: a magnet is a position-fixer. A flying marble can wake the very magnet that catches it, and no matter how wobbly the flight was, the magnet always drops it dead straight (<5px) - precise enough to thread a cactus gap.",
    "fixed": [
     {
      "type": "shelf",
      "x": 260,
      "y": 220,
      "w": 220,
      "h": 20,
      "angle": 0
     },
     {
      "type": "spikes",
      "x": 380,
      "y": 658,
      "angle": 0
     },
     {
      "type": "spikes",
      "x": 520,
      "y": 658,
      "angle": 0
     },
     {
      "type": "bell",
      "x": 450,
      "y": 660
     }
    ],
    "tray": [
     {
      "type": "conveyor",
      "count": 1
     },
     {
      "type": "ball_marble",
      "count": 1
     },
     {
      "type": "magnet",
      "count": 1
     }
    ],
    "solution": [
     {
      "type": "conveyor",
      "x": 300,
      "y": 197,
      "dir": "right"
     },
     {
      "type": "ball_marble",
      "x": 250,
      "y": 166
     },
     {
      "type": "magnet",
      "x": 450,
      "y": 180
     }
    ],
    "sparkles": [
     {
      "x": 390,
      "y": 172
     },
     {
      "x": 450,
      "y": 420
     },
     {
      "x": 450,
      "y": 560
     }
    ],
    "hintText": "The belt launches my marble flying - and BONK, it wakes the magnet, which snatches it out of the air! My magnet isn't just grabby, it's tidy: it always lets go perfectly straight down. Park it right over the gap between the prickles... bullseye, DING!"
   }
  ];
});
