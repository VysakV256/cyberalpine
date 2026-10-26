using UnrealBuildTool;
public class CyberquestUnreal : ModuleRules
{
    public CyberquestUnreal(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] {
            "Core", "CoreUObject", "Engine", "InputCore", "Json", "JsonUtilities", "ProceduralMeshComponent"
        });
    }
}
