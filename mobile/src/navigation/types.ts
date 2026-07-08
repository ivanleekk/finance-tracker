export type RootStackParamList = {
    Login: undefined;
    Signup: undefined;
    OnboardingStep1: undefined;
    OnboardingStep2: { householdId: string; suggestedName: string } | undefined;
    Main: undefined;
    GoalDetail: { id: string; name: string };
    More: undefined;
    Dividends: undefined;
    Goals: undefined;
    Household: undefined;
    Settings: undefined;
};

export type MainTabParamList = {
    Dashboard: undefined;
    Accounts: undefined;
    Portfolio: undefined;
    Transactions: undefined;
    MoreTab: undefined;
};
