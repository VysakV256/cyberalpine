#pragma once
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "CyberquestGameMode.generated.h"
UCLASS()
class CYBERQUESTUNREAL_API ACyberquestGameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    ACyberquestGameMode();
    virtual void StartPlay() override;
};
