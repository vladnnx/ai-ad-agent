import type { AdEvent, Arm, CampaignSpec } from "@/core/types";

/**
 * Шов №1 — адаптер площадки.
 * Любой рекламный сервис (Яндекс, Google, Meta, Telegram) прячется за этим интерфейсом.
 * Новая площадка = новый класс, реализующий AdPlatform. Агент, метрики и UI не меняются.
 */
export interface AdPlatform {
  /** название площадки (для UI/логов) */
  readonly name: string;

  /** завести кампанию с креативами, вернуть список созданных «рук» */
  createCampaign(spec: CampaignSpec): Arm[];

  /** текущее состояние всех рук */
  getArms(): Arm[];

  /** управление ставкой конкретной руки */
  setBid(armId: string, bid: number): void;

  /** управление дневным бюджетом */
  setBudget(armId: string, budget: number): void;

  /** включить / поставить на паузу руку */
  setArmState(armId: string, state: "active" | "paused"): void;

  /**
   * продвинуть площадку на один тик «времени» и вернуть события,
   * порожденные с момента since (event-sourcing — отдаем сырой поток, не метрики)
   */
  pullEvents(since: number): AdEvent[];

  /** текущее симуляционное время площадки (unix ms) */
  now(): number;
}
