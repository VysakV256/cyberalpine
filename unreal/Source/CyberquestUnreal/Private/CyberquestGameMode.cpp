#include "CyberquestGameMode.h"
#include "CyberquestUniverse.h"
#include "CyberquestGazePawn.h"
#include "EngineUtils.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
ACyberquestGameMode::ACyberquestGameMode() { DefaultPawnClass = ACyberquestGazePawn::StaticClass(); }
void ACyberquestGameMode::StartPlay()
{
    Super::StartPlay();
    TActorIterator<ACyberquestUniverse> Existing(GetWorld());
    if (!Existing) GetWorld()->SpawnActor<ACyberquestUniverse>();
    if (ACyberquestGazePawn* Pawn = Cast<ACyberquestGazePawn>(UGameplayStatics::GetPlayerPawn(this, 0)))
        Pawn->SetGaze(FVector(0.f, -65.f, 42.f), 0.f, -.36f, 72.f);
}
