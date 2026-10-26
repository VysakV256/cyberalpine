using UnrealBuildTool;
using System.Collections.Generic;
public class CyberquestUnrealEditorTarget : TargetRules
{
    public CyberquestUnrealEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V2;
        ExtraModuleNames.Add("CyberquestUnreal");
    }
}
