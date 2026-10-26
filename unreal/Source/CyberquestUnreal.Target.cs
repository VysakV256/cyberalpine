using UnrealBuildTool;
using System.Collections.Generic;
public class CyberquestUnrealTarget : TargetRules
{
    public CyberquestUnrealTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V2;
        ExtraModuleNames.Add("CyberquestUnreal");
    }
}
