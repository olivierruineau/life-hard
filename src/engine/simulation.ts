import { DEFAULT_HERBIVORE_PARAMS, HerbivorePopulation } from './herbivore.ts';
import { DEFAULT_PREDATOR_PARAMS, PredatorPopulation } from './predator.ts';
import { hashStringToSeed, mulberry32, type Rng } from './random.ts';
import { World } from './world.ts';

export interface SimulationParams {
  width: number;
  height: number;
  seed: string;
  waterLevel: number;
  reliefOctaves: number;
  initialHerbivores: number;
  initialPredators: number;
}

export const DEFAULT_SIMULATION_PARAMS: SimulationParams = {
  width: 96,
  height: 64,
  seed: 'life-hard',
  waterLevel: 0.35,
  reliefOctaves: 5,
  initialHerbivores: 150,
  initialPredators: 8,
};

export class Simulation {
  readonly world: World;
  readonly herbivores: HerbivorePopulation;
  readonly predators: PredatorPopulation;
  private readonly rng: Rng;
  readonly params: SimulationParams;
  tick = 0;

  constructor(params: SimulationParams) {
    this.params = params;
    this.rng = mulberry32(hashStringToSeed(params.seed));
    this.world = new World({
      width: params.width,
      height: params.height,
      rng: this.rng,
      waterLevel: params.waterLevel,
      reliefOctaves: params.reliefOctaves,
    });
    this.herbivores = new HerbivorePopulation(DEFAULT_HERBIVORE_PARAMS);
    this.herbivores.spawnRandom(this.world, params.initialHerbivores, this.rng);
    this.predators = new PredatorPopulation(DEFAULT_PREDATOR_PARAMS);
    this.predators.spawnRandom(this.world, params.initialPredators, this.rng);
  }

  step(): void {
    this.world.step();
    this.herbivores.moveAndFeed(this.world, this.rng);
    this.predators.moveAndHunt(this.world, this.herbivores, this.rng);
    this.herbivores.reproduceAndCleanup(this.world, this.rng);
    this.predators.reproduceAndCleanup(this.world, this.rng);
    this.tick++;
  }
}
